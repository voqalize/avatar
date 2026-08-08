"""Frames in, avatar messages out — the base states, inferred from stock frames.

Deliberately synchronous, dependency-free and pipeline-free: it takes a frame
(or a named event) and returns the list of messages that frame implies. No
timers, no I/O, no `await`. Everything about *when* the avatar changes is
therefore a pure function of what the pipeline actually did, which is the only
way this stays testable — the alternative, heuristics smeared through an async
processor, is a state machine you can only observe by running a call.

**Everything it reads is stock pipecat.** That is the deal this class offers: a
pipeline built from ordinary services gets listening, thinking, speaking, the
floor claim, the yield and the failure states with no application code at all.
The states it cannot infer — the ones that depend on what the application is
*doing* — arrive as `AvatarControlFrame` and pass straight through (`_on_control`).

Two rules shape the output:

- **A state is a condition; an interjection is an event.** The same state is
  never sent twice in a row (the widget would re-enter the pose and re-trigger
  its idle profile for no reason); an interjection is always sent, because a
  second nod *is* a second nod.
- **Nothing here is autonomous.** Every message is caused by a frame the
  pipeline produced. Backchannel timing belongs to the widget's listening
  engine, which times off the user's voice; anything that needs to know what the
  application is up to belongs to the application. A server that guesses is a
  server that nods at the wrong moment.

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
    AggregatedTextFrame,
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
    TTSStartedFrame,
    TTSStoppedFrame,
    TTSTextFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    UserTurnInferenceCompletedFrame,
)

from .frames import AvatarControlFrame
from .messages import AvatarMessage, AvatarState, Interjection, SpeechEvent


class AvatarStateMachine:
    """Translates one session's frame stream into avatar commands.

    Constructed by `AvatarProcessor` and reachable no other way. Everything it
    decides is inferred from stock pipecat frames; anything it cannot infer — a
    tool-specific pose, a deliberate gesture — arrives as an `AvatarControlFrame`
    from the application's own processor.
    """

    def __init__(self) -> None:
        # Inferences are numbered rather than named when the pipeline gives us
        # no id of its own. The client only needs `ctx` to be stable within a
        # turn and different between turns — it keys the cue splice on it.
        self._inference = 0
        # The last state actually *sent*, which is what dedup answers to — not
        # the state we believe the widget is in. An `AvatarProcessor.send()` from
        # outside the pipeline bypasses this and we do not track it; an
        # `AvatarControlFrame` does update it, which is the point of `_on_control`.
        self._state: AvatarState | None = None
        self._ctx = ""
        self._user_speaking = False
        # `user speaking` is a condition like a state, so it dedups like one.
        # A turn-aware STT and the VAD can both announce the same onset.
        self._user_reported: bool | None = None
        self._bot_speaking = False
        # `speech start` opened a turn clock on the client; only one stop closes
        # it. Barge-in sends the stop early, so the transport's own
        # BotStoppedSpeaking must not send a second.
        self._speech_open = False
        # The inbreath is claimed once per bot turn. TTS may start several times
        # inside one turn (one per inference or sentence batch); a CLAIM_FLOOR
        # per sentence would read as a stutter.
        self._floor_claimed = False
        self._interrupted = False
        self._tools_in_flight: set[str] = set()
        # A user turn has produced text but has not yet reached a resting point.
        # THINKING waits for both halves — the words and the silence.
        self._pending_commit = False
        self._offline = False

    # ─── Introspection ──────────────────────────────────────────────────

    @property
    def state(self) -> AvatarState | None:
        """The last state sent, or None before the session starts."""
        return self._state

    @property
    def ctx(self) -> str:
        """The turn id for the inference now in flight — see `_next_ctx`."""
        return self._ctx

    @property
    def tools_in_flight(self) -> int:
        return len(self._tools_in_flight)

    # ─── Out-of-band events ─────────────────────────────────────────────

    def start(self) -> list[AvatarMessage]:
        """The pipeline came up. Nothing is happening yet."""
        return self._enter(AvatarState.IDLE)

    def resync(self) -> list[AvatarMessage]:
        """The client (re)connected and may have missed everything so far.

        Deliberately bypasses dedup: the memo tracks what we *sent*, and a
        client that was not listening did not receive it.
        """
        if self._state is None:
            return self._enter(AvatarState.IDLE)
        return [AvatarMessage.state(self._state)]

    # ─── The frame stream ───────────────────────────────────────────────

    def on_frame(self, frame: Frame) -> list[AvatarMessage]:
        # OFFLINE is terminal by design: the agent is gone, and a later frame
        # from a tearing-down pipeline must not animate a corpse.
        if self._offline:
            return []

        # Audio first: it is by far the most frequent frame, and once the floor
        # is claimed the check costs one boolean.
        if isinstance(frame, TTSAudioRawFrame):
            return self._claim_floor()

        if isinstance(frame, AvatarControlFrame):
            return self._on_control(frame)

        # The sentence announcement, pushed immediately before the
        # `TTSStartedFrame` of the audio context it describes and so the earliest
        # honest evidence of imminent speech — roughly 450 ms of lead. It matters
        # most on services that pre-create their audio contexts and emit
        # `TTSStartedFrame` far too early or not at all, leaving the first
        # `TTSAudioRawFrame` as the trigger: an inbreath landing on top of the
        # first syllable, which is not an inbreath at all. `TTSTextFrame`
        # subclasses this and sets the same flag; those are the per-word karaoke
        # frames, and one per word would be a stutter.
        if (
            isinstance(frame, AggregatedTextFrame)
            and not isinstance(frame, TTSTextFrame)
            and frame.will_be_spoken
        ):
            return self._on_sentence_queued(frame)

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
            return self._recover_from_yield()
        if isinstance(frame, UserTurnInferenceCompletedFrame):
            self._pending_commit = True
            return self._maybe_think()
        if isinstance(frame, LLMFullResponseStartFrame):
            self._inference += 1
            self._ctx = self._next_ctx()
            return []
        if isinstance(frame, TTSStartedFrame):
            return self._on_tts_started(frame)
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

    def _next_ctx(self) -> str:
        """The turn id the client keys its cue splice on.

        Opaque to the widget, which only needs it to be stable within a turn and
        different between turns. A TTS context id replaces it as soon as one
        exists (`_on_sentence_queued`, `_on_tts_started`); this is what a turn is
        called before then.
        """
        return f"turn.{self._inference}"

    def _on_sentence_queued(self, frame: AggregatedTextFrame) -> list[AvatarMessage]:
        """A sentence's text just went to the TTS; no audio exists yet.

        The context is adopted only when this sentence is the one claiming the
        floor. A later sentence in the same turn must not re-point the context the
        open `speech:start` was announced under; the client's cue clock is
        anchored to that one.
        """
        if frame.context_id and not self._bot_speaking and not self._floor_claimed:
            self._ctx = frame.context_id
        return self._claim_floor()

    # ─── The user's turn ────────────────────────────────────────────────

    def _on_user_started(self) -> list[AvatarMessage]:
        self._user_speaking = True
        # Speech began, so a turn is coming. The transcript that would confirm
        # it never reaches this seat — the user aggregator consumes
        # TranscriptionFrames upstream of the avatar — so voice onset is the
        # evidence, and an empty final transcript withdraws it below.
        self._pending_commit = True
        # State first, then the truth flag: the widget's listening engine only
        # backchannels in LISTENING/WAITING_FOR_USER, so arriving in the state
        # before the voice signal means the very first pause is already live.
        return [*self._enter(AvatarState.LISTENING), *self._report_user(speaking=True)]

    def _on_user_stopped(self) -> list[AvatarMessage]:
        self._user_speaking = False
        # The state deliberately *holds*: a pause is not the end of a turn, and
        # LISTENING is where the widget's contingent acknowledgements live.
        return [*self._report_user(speaking=False), *self._maybe_think()]

    def _report_user(self, *, speaking: bool) -> list[AvatarMessage]:
        if speaking is self._user_reported:
            return []
        self._user_reported = speaking
        return [AvatarMessage.user(speaking=speaking)]

    def _on_transcription(self, frame: TranscriptionFrame) -> list[AvatarMessage]:
        out = self._recover_from_yield()
        # An empty final transcript is the endpointer saying it heard noise, not
        # speech: withdraw the turn rather than send the avatar off to think
        # about nothing.
        self._pending_commit = bool(frame.text.strip())
        return [*out, *self._maybe_think()]

    def _maybe_think(self) -> list[AvatarMessage]:
        """THINKING needs both halves of a committed turn: words *and* silence.

        The two arrive in either order — a finalized transcript can land before
        or after the matching UserStoppedSpeaking — so this fires on whichever
        is second rather than picking one frame and hoping.
        """
        if not self._pending_commit or self._user_speaking:
            return []
        self._pending_commit = False
        return self._enter(AvatarState.THINKING)

    def _recover_from_yield(self) -> list[AvatarMessage]:
        """YIELDED is a recoil, not a resting place.

        After a barge-in the user is already mid-sentence, so no new
        UserStartedSpeaking is coming; the next transcript fragment is the
        evidence that the floor really did change hands.
        """
        if self._state is AvatarState.YIELDED and self._user_speaking:
            return self._enter(AvatarState.LISTENING)
        return []

    # ─── The agent's turn ───────────────────────────────────────────────

    def _on_tts_started(self, frame: TTSStartedFrame) -> list[AvatarMessage]:
        if frame.context_id:
            self._ctx = frame.context_id
        return self._claim_floor()

    def _claim_floor(self) -> list[AvatarMessage]:
        """The inbreath, on whichever evidence of imminent speech arrives first.

        `TTSStartedFrame` is the intended trigger, but not every TTS service
        emits one, and synthesized audio is the fact underneath it: either way
        generation runs ahead of playout, so this lands a few hundred
        milliseconds before the first sample — the anticipation moment. The
        inhale ends *held*, and the audio resolves it.
        """
        if self._bot_speaking or self._floor_claimed:
            return []
        self._floor_claimed = True
        return [
            *self._enter(AvatarState.TAKING_FLOOR),
            AvatarMessage.interject(Interjection.CLAIM_FLOOR),
        ]

    def _on_bot_started(self) -> list[AvatarMessage]:
        if self._bot_speaking:
            return []
        self._bot_speaking = True
        self._interrupted = False
        self._speech_open = True
        # Playout-true, not generation-true: this frame is emitted by the output
        # transport as the first sample goes out, which is the only moment that
        # can anchor the cue clock at t=0.
        return [AvatarMessage.speech(SpeechEvent.START, ctx=self._ctx)]

    def _on_bot_stopped(self) -> list[AvatarMessage]:
        if not self._bot_speaking:
            return []
        self._bot_speaking = False
        self._floor_claimed = False
        out: list[AvatarMessage] = []
        if self._speech_open:
            self._speech_open = False
            out.append(AvatarMessage.speech(SpeechEvent.STOP, ctx=self._ctx))
        if self._interrupted:
            # A cut turn already handed the floor over; WAITING_FOR_USER here
            # would claim the agent asked something and is now waiting.
            self._interrupted = False
            return out
        return [*out, *self._enter(AvatarState.WAITING_FOR_USER)]

    def _on_interruption(self) -> list[AvatarMessage]:
        if not self._bot_speaking and not self._floor_claimed:
            # Interruption is broadcast for pipeline hygiene and fires on plenty
            # of turns where the agent held no floor to yield.
            return []
        self._interrupted = True
        self._floor_claimed = False
        out = [
            *self._enter(AvatarState.YIELDED),
            AvatarMessage.interject(Interjection.YIELD_FLOOR),
        ]
        if self._speech_open:
            self._speech_open = False
            out.append(AvatarMessage.speech(SpeechEvent.STOP, ctx=self._ctx))
        return out

    # ─── Explicit control ───────────────────────────────────────────────

    def _on_control(self, frame: AvatarControlFrame) -> list[AvatarMessage]:
        """Pass an application's own instruction through, and *remember* it.

        The memo update is the whole reason this goes through the state machine
        rather than straight out of the processor. Dedup answers to the last
        state sent; if an application sets `TYPING` behind the machine's back,
        the machine still believes `LISTENING` is current and will swallow the
        next inferred `LISTENING` as a no-op — leaving the avatar typing for the
        rest of the call. Whoever spoke last owns the memo.
        """
        message = frame.message
        if message.cmd == "state":
            name = message.payload.get("name")
            try:
                self._state = AvatarState(name)
            except ValueError:
                # The widget throws on an unknown state, so let it surface here
                # instead — at the seat that can name the offending application.
                raise ValueError(f"unknown avatar state {name!r} in AvatarControlFrame") from None
        return [message]

    # ─── Tool calls ─────────────────────────────────────────────────────

    def tool_started(self, tool_call_id: str) -> list[AvatarMessage]:
        """Parallel calls enter THINKING once and hold it until the last result.

        Keyed on `tool_call_id` rather than counted so a repeated announcement
        (pipecat sends both *Started* and *InProgress* for the same call) cannot
        inflate the count and strand the avatar in THINKING.

        THINKING for every tool, with no per-tool mapping: it is true of every
        tool call and wrong about none of them. An application that wants
        `SEARCHING_SCREEN` while its own search runs knows that from its own code
        and says so with an `AvatarControlFrame` — which is also the only thing
        that works when the LLM executes tools out of process and no function-call
        frame is produced at all.

        Public, with `tool_finished`, because they are the seam: a subclass
        translating its own out-of-process tool frames inherits the dedup and
        the hold rather than reimplementing them approximately.
        """
        if tool_call_id in self._tools_in_flight:
            return []
        self._tools_in_flight.add(tool_call_id)
        return self._enter(AvatarState.THINKING)

    def tool_finished(self, tool_call_id: str) -> list[AvatarMessage]:
        """Reaching zero is deliberately not a state change: the LLM is still
        composing its reply, and THINKING holds until TTS claims the floor."""
        self._tools_in_flight.discard(tool_call_id)
        return []

    # ─── Failure ────────────────────────────────────────────────────────

    def _on_error(self, frame: ErrorFrame) -> list[AvatarMessage]:
        return self._fail(fatal=frame.fatal)

    def _fail(self, *, fatal: bool) -> list[AvatarMessage]:
        if fatal:
            return self._go_offline()
        # No timer and no explicit recovery message: the next thing that
        # genuinely happens — a user turn, a tool call, the agent taking the
        # floor — carries the avatar out of DEGRADED into whatever is true then.
        # A scheduled recovery would have to guess a state, and guessing is how
        # you get an avatar that looks fine while the pipeline is broken.
        return self._enter(AvatarState.DEGRADED)

    def _go_offline(self) -> list[AvatarMessage]:
        self._offline = True
        self._state = AvatarState.OFFLINE
        return [AvatarMessage.state(AvatarState.OFFLINE)]

    # ─── Dedup ──────────────────────────────────────────────────────────

    def _enter(self, state: AvatarState) -> list[AvatarMessage]:
        if state is self._state:
            return []
        self._state = state
        return [AvatarMessage.state(state)]
