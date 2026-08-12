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
  carries a `THINKING`/`WORKING` claim or an action in pipeline order; Pipecat
  lifecycle is not redundantly translated into a second state protocol.
- **No client-side conversational inference.** The browser may project factual
  lifecycle posture, but every acknowledgement, nod and semantic reaction still
  arrives as an explicit application action.

One caveat about the frame diet. This class reads whatever a caller feeds it,
but the seat it is *mounted* at — between TTS and the output transport — is
downstream of the user context aggregator, which in most pipelines consumes
transcription frames. So `_on_transcription` may never fire: the turn is armed
by voice onset instead, and the transcript handlers are the fallback for a
pipeline whose transcripts do reach the seat. Nothing here may *depend* on a
transcript arriving.
"""

from __future__ import annotations

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    ErrorFrame,
    Frame,
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
        # A durable server-owned hint. The browser's Pipecat facts take
        # precedence and it retires this at a real turn boundary.
        self._claim: AvatarClaim | None = None
        self._user_speaking = False
        self._bot_speaking = False
        self._tools_in_flight: set[str] = set()
        # A user turn has produced text but has not yet reached a resting point.
        # THINKING waits for both halves — the words and the silence.
        self._pending_commit = False
        self._offline = False

    # ─── Introspection ──────────────────────────────────────────────────

    @property
    def claim(self) -> AvatarClaim | None:
        """The current lower-priority server claim, if any."""
        return self._claim

    @property
    def tools_in_flight(self) -> int:
        return len(self._tools_in_flight)

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
            self._pending_commit = True
            return []
        if isinstance(frame, LLMFullResponseStartFrame):
            return self._set_claim(None)
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
        return []

    # ─── The user's turn ────────────────────────────────────────────────

    def _on_user_started(self) -> list[AvatarMessage]:
        self._user_speaking = True
        self._pending_commit = True
        return self._set_claim(None)

    def _on_user_stopped(self) -> list[AvatarMessage]:
        self._user_speaking = False
        return self._set_claim(AvatarClaim.THINKING)

    def _on_transcription(self, frame: TranscriptionFrame) -> list[AvatarMessage]:
        # An empty final transcript is the endpointer saying it heard noise, not
        # speech: withdraw the turn rather than treating it as a completed turn.
        self._pending_commit = bool(frame.text.strip())
        return []

    # ─── The agent's turn ───────────────────────────────────────────────

    def _on_bot_started(self) -> list[AvatarMessage]:
        if self._bot_speaking:
            return []
        self._bot_speaking = True
        return self._set_claim(None)

    def _on_bot_stopped(self) -> list[AvatarMessage]:
        if not self._bot_speaking:
            return []
        self._bot_speaking = False
        return []

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
        inflate the count and strand the avatar in THINKING.

        RTVI function events are optional at the browser, so server observation
        is the authority for this durable lower-priority state.
        """
        if tool_call_id in self._tools_in_flight:
            return []
        self._tools_in_flight.add(tool_call_id)
        return self._set_claim(AvatarClaim.WORKING)

    def tool_finished(self, tool_call_id: str) -> list[AvatarMessage]:
        self._tools_in_flight.discard(tool_call_id)
        return self._set_claim(None) if not self._tools_in_flight else []

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

    # ─── Dedup ──────────────────────────────────────────────────────────

    def _set_claim(self, claim: AvatarClaim | None) -> list[AvatarMessage]:
        if claim is self._claim:
            return []
        self._claim = claim
        return [AvatarMessage.claim(claim)]
