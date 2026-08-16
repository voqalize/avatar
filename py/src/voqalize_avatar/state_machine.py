"""Frames in, claims/actions and stock-context viseme messages out.

Deliberately synchronous, dependency-free and pipeline-free: it takes a frame
(or a named event) and returns the list of messages that frame implies. No
timers, no I/O, no `await`. Everything about *when* the avatar changes is
therefore a pure function of what the pipeline actually did, which is the only
way this stays testable — the alternative, heuristics smeared through an async
processor, is a state machine you can only observe by running a call.

**Everything it reads is stock pipecat.** The browser receives the same
lifecycle through Pipecat's JavaScript client and projects factual speech and
failure presentation locally. This class emits lower-priority server claims and
explicit actions; the processor emits viseme cues keyed by TTS context.

Two rules shape the output:

- **A claim is lower-priority application intent.** `AvatarControlFrame`
  carries a `STRAINING`/`THINKING`/`WORKING` claim or an action in pipeline
  order; Pipecat lifecycle is not redundantly translated into a second state
  protocol.
- **No client-side conversational inference.** The browser may project factual
  lifecycle posture, but every acknowledgement, nod and semantic reaction still
  arrives as an explicit application action.

## What the claims mean, and why they are inferred this way

The hard part is the stretch where neither party is speaking. `IDLE` is the
wrong answer there almost every time: something is happening, it is just not
audible, and a face that goes blank while the model is mid-inference reads as
*disconnected* rather than *busy*. So this class keeps a small set of latches,
each one a fact about the frame stream, and resolves them in a fixed order.

| claim | latch | armed by | retired by |
|---|---|---|---|
| `STRAINING` | nothing came back | a turn that ended with no text, or `waited()` | the next user turn, or any sign of a response |
| `THINKING` | a reply is outstanding | `UserStoppedSpeakingFrame`, `LLMFullResponseStartFrame` | `BotStartedSpeakingFrame` |
| `WORKING` | a tool is running | `FunctionCalls*Frame` | the last call's result — or its cancel |

Only one claim is on the wire at a time, so **when several latches are set the
resolution order is the whole design** — `_resolve`. `WORKING` sits at the
bottom, below `THINKING`, which needs saying because it makes the obvious
implementation wrong: tool calls happen *inside* an outstanding reply, so if
`THINKING` stayed armed across one, `WORKING` could never win and would be a
state nothing reaches. It does not stay armed, and the reason is not a
workaround — a model blocked on a tool result is not composing an answer. The
`THINKING` latch is therefore "waiting on the model for words", which an
in-flight tool suspends and the tool's result resumes.

## What is not here, and why

**Mute is not a claim.** `UserMuteStartedFrame`/`UserMuteStoppedFrame` are stock
pipecat, the RTVI observer already converts them, and `PipecatClient` already
raises `userMuteStarted`/`userMuteStopped` — so "the agent has muted you" reaches
the browser as a *fact* without this class saying anything. Adding a claim for it
would be the library inventing a second, lower-authority spelling of something
pipecat states directly.

**"The turn strategy is still holding the turn open" is not here either**, and
that is a client limitation rather than a preference. It is perfectly visible
from this seat — `VADUserStoppedSpeakingFrame` arrives while the turn stays open
— but pipecat's JavaScript client reports the user as speaking for the whole
hold and exposes no VAD event to contradict it, so a claim raised there would
lose the ladder to `LISTENING` every time. A claim that can never win is not a
feature.

One caveat about the frame diet. This class reads whatever a caller feeds it,
but the seat it is *mounted* at — between TTS and the output transport — is
downstream of the user context aggregator, which in most pipelines consumes
transcription frames. So `_on_transcription` may never fire: it is the *fast*
path to `STRAINING` for a pipeline whose transcripts do reach the seat, and
`waited()` is the one that works everywhere. Nothing here may *depend* on a
transcript arriving.
"""

from __future__ import annotations

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    ErrorFrame,
    Frame,
    FunctionCallCancelFrame,
    FunctionCallInProgressFrame,
    FunctionCallResultFrame,
    FunctionCallsStartedFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    LLMFullResponseStartFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSStoppedFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    UserTurnInferenceCompletedFrame,
)

from .frames import AvatarControlFrame
from .messages import AvatarClaim, AvatarMessage


class AvatarStateMachine:
    """Translates one session's frame stream into avatar commands.

    Constructed by `AvatarProcessor` and reachable no other way. Everything it
    decides is inferred from stock pipecat frames; anything it cannot infer — a
    tool-specific pose, a deliberate gesture — arrives as an `AvatarControlFrame`
    from the application's own processor.
    """

    def __init__(self) -> None:
        # The last claim put on the wire. Everything else here is a latch; this
        # is the memo that keeps `_resolve` from repeating itself.
        self._claim: AvatarClaim | None = None
        self._user_speaking = False
        self._bot_speaking = False
        self._tools_in_flight: set[str] = set()
        # A reply is outstanding: the model owes us words and has not produced
        # any yet. Set at the end of the user's turn rather than at the LLM's
        # start, so the transcription and routing latency in between is covered
        # too — that gap is a second or more in a real pipeline, and it is the
        # single longest stretch where the face used to have nothing to show.
        self._awaiting_reply = False
        # The turn came back with nothing to answer. Distinct from
        # `_awaiting_reply` because it is the *end* of waiting, not more of it.
        self._straining = False
        self._offline = False

    # ─── Introspection ──────────────────────────────────────────────────

    @property
    def claim(self) -> AvatarClaim | None:
        """The current lower-priority server claim, if any."""
        return self._claim

    @property
    def tools_in_flight(self) -> int:
        return len(self._tools_in_flight)

    @property
    def awaiting_reply(self) -> bool:
        """A reply is outstanding and nothing has come back yet.

        `AvatarProcessor` reads this to decide whether its grace timer should be
        running: while it is true there is something to give up on, and giving up
        is what `waited()` means. The processor owns the clock because this class
        does not have one — see the module docstring.
        """
        return self._awaiting_reply

    # ─── Out-of-band events ─────────────────────────────────────────────

    def start(self) -> list[AvatarMessage]:
        """The browser's Pipecat `BotReady` event establishes its idle pose."""
        return []

    def resync(self) -> list[AvatarMessage]:
        """The client (re)connected and may have missed everything so far.

        Deliberately bypasses dedup: the memo tracks what we *sent*, and a
        client that was not listening did not receive it.
        """
        return [] if self._claim is None else [AvatarMessage.claim(self._claim)]

    def waited(self) -> list[AvatarMessage]:
        """The grace period expired with the reply still outstanding.

        Called by `AvatarProcessor` when `awaiting_reply` has been true for
        longer than a response plausibly takes to *begin*. What that means is
        settled: the aggregation the user's turn produced was empty, so no
        context was ever sent and no response is coming. The face should stop
        waiting and start listening harder.

        This is the leg that works in every pipeline. `_on_transcription` reaches
        the same conclusion without a clock, but only where transcripts reach
        this seat, which is the minority.
        """
        if not self._awaiting_reply:
            return []
        self._awaiting_reply = False
        self._straining = True
        return self._resolve()

    # ─── The frame stream ───────────────────────────────────────────────

    def on_frame(self, frame: Frame) -> list[AvatarMessage]:
        # OFFLINE is terminal by design: the agent is gone, and a later frame
        # from a tearing-down pipeline must not animate a corpse.
        if self._offline:
            return []

        # Audio is frequent and only matters to the viseme accumulator in the
        # processor. Pipecat's browser client owns floor-taking presentation.
        if isinstance(frame, TTSAudioRawFrame):
            return []

        if isinstance(frame, AvatarControlFrame):
            return self._on_control(frame)

        if isinstance(frame, ErrorFrame):
            return self._on_error(frame)
        if isinstance(frame, CancelFrame):
            return self._go_offline()
        if isinstance(frame, InterruptionFrame):
            return self._on_interruption()
        if isinstance(frame, UserStartedSpeakingFrame):
            return self._on_user_started()
        if isinstance(frame, UserStoppedSpeakingFrame):
            return self._on_user_stopped()
        if isinstance(frame, BotStartedSpeakingFrame):
            return self._on_bot_started()
        if isinstance(frame, BotStoppedSpeakingFrame):
            return self._on_bot_stopped()
        if isinstance(frame, TranscriptionFrame):
            return self._on_transcription(frame)
        if isinstance(frame, InterimTranscriptionFrame):
            return []
        if isinstance(frame, UserTurnInferenceCompletedFrame):
            # Somebody judged the turn semantically complete. That is a promise
            # the user is done, not that a reply exists — so it arms the wait
            # rather than ending it, and the empty-aggregation case still resolves
            # through `waited()`.
            self._awaiting_reply = True
            self._straining = False
            return self._resolve()
        if isinstance(frame, LLMFullResponseStartFrame):
            # The frame the heuristic actually wants is `LLMContextFrame` — input
            # reached the model. It never gets here: the LLM service consumes it
            # and pushes this in its place, immediately before processing the
            # context (`services/openai/base_llm.py`). Downstream of an LLM, this
            # *is* "the model has been given something to answer".
            #
            # It re-arms rather than clears, which is the fix for the reported
            # bug: this used to set the claim to None, so the entire model+TTS
            # latency window — the longest silence in a call — was claimless and
            # the widget fell through its ladder to IDLE.
            self._awaiting_reply = True
            self._straining = False
            return self._resolve()
        if isinstance(frame, TTSStoppedFrame):
            # Nothing: TTSStopped means *generation* finished, and generation
            # outruns playout — the audio is still going out. The turn ends at
            # BotStoppedSpeaking, which is playout-true.
            return []
        if isinstance(frame, FunctionCallsStartedFrame):
            # One frame, many calls. Announced together, they must still enter
            # THINKING exactly once.
            out: list[AvatarMessage] = []
            for call in frame.function_calls:
                out += self.tool_started(call.tool_call_id)
            return out
        if isinstance(frame, FunctionCallInProgressFrame):
            return self.tool_started(frame.tool_call_id)
        if isinstance(frame, FunctionCallResultFrame):
            return self.tool_finished(frame.tool_call_id)
        if isinstance(frame, FunctionCallCancelFrame):
            return self.tool_cancelled(frame.tool_call_id)
        return []

    # ─── The user's turn ────────────────────────────────────────────────

    def _on_user_started(self) -> list[AvatarMessage]:
        self._user_speaking = True
        # A new turn retires everything the last one was waiting on. Whatever we
        # had not worked out by now, we are not going to.
        self._awaiting_reply = False
        self._straining = False
        return self._resolve()

    def _on_user_stopped(self) -> list[AvatarMessage]:
        self._user_speaking = False
        self._awaiting_reply = True
        return self._resolve()

    def _on_transcription(self, frame: TranscriptionFrame) -> list[AvatarMessage]:
        # An empty final transcript is the endpointer saying it heard noise, not
        # speech. Nothing will be sent to the model, so nothing is coming back:
        # stop waiting now rather than at the end of the grace period. Where
        # transcripts do not reach this seat, `waited()` reaches the same place a
        # second or so later.
        if frame.text.strip():
            return []
        self._awaiting_reply = False
        self._straining = True
        return self._resolve()

    # ─── The agent's turn ───────────────────────────────────────────────

    def _on_bot_started(self) -> list[AvatarMessage]:
        if self._bot_speaking:
            return []
        self._bot_speaking = True
        # Words arrived. Everything the wait was for is now audible, and audible
        # is a fact the browser owns — no claim survives it.
        self._awaiting_reply = False
        self._straining = False
        return self._resolve()

    def _on_bot_stopped(self) -> list[AvatarMessage]:
        if not self._bot_speaking:
            return []
        self._bot_speaking = False
        return self._resolve()

    def _on_interruption(self) -> list[AvatarMessage]:
        if not self._bot_speaking:
            # Interruption is broadcast for pipeline hygiene and fires on plenty
            # of turns where the agent held no floor to yield.
            return []
        # It is a self-completing explanation of how speech stopped, not a
        # durable state. The browser delays its mouth-owning phase until its
        # observed bot playout has actually stopped.
        return [AvatarMessage.action("RESPONSE_INTERRUPTED")]

    # ─── Explicit control ───────────────────────────────────────────────

    def _on_control(self, frame: AvatarControlFrame) -> list[AvatarMessage]:
        """Pass an application claim/action through in pipeline order."""
        message = frame.message
        if message.cmd == "claim":
            raw = message.payload.get("state")
            self._claim = None if raw is None else AvatarClaim(raw)
        return [message]

    # ─── Tool calls ─────────────────────────────────────────────────────

    def tool_started(self, tool_call_id: str) -> list[AvatarMessage]:
        """Track parallel calls and claim `WORKING` once.

        Keyed on `tool_call_id` rather than counted so a repeated announcement
        (pipecat sends both *Started* and *InProgress* for the same call) cannot
        inflate the count and strand the avatar in the wrong state.

        Suspending `_awaiting_reply` is what makes `WORKING` reachable at all: a
        tool runs inside an outstanding reply, and `WORKING` is deliberately the
        bottom of the ladder, so a `THINKING` latch left set here would mask
        every tool call there has ever been. It is also just true — a model
        blocked on a tool result is not composing an answer.

        RTVI function events are optional at the browser, so server observation
        is the authority for this durable lower-priority state.
        """
        if tool_call_id in self._tools_in_flight:
            return []
        self._tools_in_flight.add(tool_call_id)
        self._awaiting_reply = False
        self._straining = False
        return self._resolve()

    def tool_finished(self, tool_call_id: str) -> list[AvatarMessage]:
        self._tools_in_flight.discard(tool_call_id)
        if self._tools_in_flight:
            return []
        # The result goes back to the model, which now owes us words again. The
        # second inference's `LLMFullResponseStartFrame` would say so too; this
        # says it a round-trip earlier, and there is no silence in between worth
        # showing as IDLE.
        self._awaiting_reply = True
        return self._resolve()

    def tool_cancelled(self, tool_call_id: str) -> list[AvatarMessage]:
        """A call the pipeline abandoned — an interruption, usually.

        Not a quiet duplicate of `tool_finished`: nothing goes back to the model,
        so the wait does not resume. Without it the id would never leave the set,
        and `WORKING` — the bottom of the ladder, and therefore whatever the face
        falls back to — would be where the rest of the call was spent.
        """
        if tool_call_id not in self._tools_in_flight:
            return []
        self._tools_in_flight.discard(tool_call_id)
        return self._resolve()

    # ─── Failure ────────────────────────────────────────────────────────

    def _on_error(self, frame: ErrorFrame) -> list[AvatarMessage]:
        return self._fail(fatal=frame.fatal)

    def _fail(self, *, fatal: bool) -> list[AvatarMessage]:
        if fatal:
            return self._go_offline()
        return []

    def _go_offline(self) -> list[AvatarMessage]:
        self._offline = True
        return []

    # ─── Resolution ─────────────────────────────────────────────────────

    def _resolve(self) -> list[AvatarMessage]:
        """One claim out of every latch that is set, in a fixed order.

        Called after every transition rather than at chosen moments, so a latch
        cleared by one frame and a latch set by another cannot leave the wire
        describing a state that stopped being true — which is how the old code,
        which set the claim inline at each handler, lost the whole model-latency
        window to a single stray clear.

        Speech is deliberately at the top and resolves to *nothing*. Both speech
        states are Pipecat facts the browser already has, and it outranks every
        claim with them; sending one anyway would be this library restating
        something with less authority than the copy already there.
        """
        if self._user_speaking or self._bot_speaking:
            return self._set_claim(None)
        if self._straining:
            return self._set_claim(AvatarClaim.STRAINING)
        if self._awaiting_reply:
            return self._set_claim(AvatarClaim.THINKING)
        if self._tools_in_flight:
            return self._set_claim(AvatarClaim.WORKING)
        return self._set_claim(None)

    def _set_claim(self, claim: AvatarClaim | None) -> list[AvatarMessage]:
        if claim is self._claim:
            return []
        self._claim = claim
        return [AvatarMessage.claim(claim)]
