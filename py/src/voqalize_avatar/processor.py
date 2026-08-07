"""`AvatarProcessor` — the pipeline seat that drives the browser's talking head.

Sits between `tts` and `transport.output()`. That seat is chosen, not
convenient: it observes the whole conversation at *generation* speed (a
post-output seat sees data frames delayed behind the audio queue), and it can
push frames, which a pipecat observer cannot.

It consumes nothing. Every frame is forwarded unchanged; the avatar traffic
leaves as `RTVIServerMessageFrame`s, which the `RTVIObserver` turns into RTVI
`server-message`s on the way past — protocol-version agnostic, so the widget's
vocabulary can grow without touching RTVI.

**They are pushed DOWNSTREAM, and that is load-bearing.** It is tempting to
send them upstream, because RTVI messages are "for the client" and other
processors do redirect their own. Do not: `RTVIObserver` fires on a push in
*either* direction, so downstream already delivers the client message, and
upstream hands the frame to whatever sits above this seat. In the first
deployment that was an LLM service whose serializer claimed
`RTVIServerMessageFrame` as its own wire vocabulary; it forwarded every avatar
twitch to the remote brain and blocked its frame task on an ack that was never
coming, stalling the whole pipeline below. Downstream costs nothing: the output
transport forwards it like any other system frame.

What it does *not* do: decide anything about the call. It reports what the
pipeline did. Backchannel timing lives in the widget's listening engine (it has
the user's voice and the research behind the timing); anything that depends on
what the application is *doing* — a deliberate performance, a tool-specific
pose, user-idle behaviour — is signalled explicitly, either as an
`AvatarControlFrame` from a processor of your own (see `frames.py`) or through
`send()` from outside the pipeline entirely.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence
from typing import Any, Protocol, runtime_checkable

from loguru import logger
from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    CancelFrame,
    EndFrame,
    Frame,
    InterruptionFrame,
    StartFrame,
    TTSAudioRawFrame,
    TTSStoppedFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame

from .messages import AvatarMessage
from .sentence_audio import (
    EARLY_PARTIAL_BYTES,
    SentenceAudioAccumulator,
    SentenceBoundaryFrame,
)
from .state_machine import AvatarStateMachine

# Room for a resync and a hint or two. Nothing legitimate queues more than a
# handful before the pipeline starts.
_PRESTART_BUFFER = 8


@runtime_checkable
class SentenceAudioSink(Protocol):
    """Whoever turns a sentence's bytes into mouth shapes.

    Structural on purpose. `VisemeEngine` satisfies this without knowing it
    exists, which is what keeps the state channel and the viseme stack from
    importing each other — they are wired together in `wiring.py` and meet
    nowhere else. The native runtime stays out of this module's import graph.
    """

    async def on_sentence_audio(
        self,
        ctx: str,
        pcm: bytes,
        word_timestamps: Sequence[tuple[str, float]] | None = None,
    ) -> None: ...

    async def on_sentence_partial(self, ctx: str, pcm: bytes) -> None: ...

    async def on_context_closed(self, ctx: str) -> None: ...

    async def end_turn(self, ctx: str) -> None: ...


class AvatarProcessor(FrameProcessor):
    """Observes the frame stream; emits avatar commands to the browser.

    The state machine is passed in rather than defaulted, because it is the
    thing an application configures (`tool_states`, and whatever grows next);
    hiding it behind a default would make the one interesting knob invisible.
    The audio sink is genuinely optional — attached later or not at all, since
    whether visemes are possible on this node is only known after the processor
    exists.
    """

    def __init__(
        self,
        state_machine: AvatarStateMachine,
        *,
        audio_sink: SentenceAudioSink | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._machine = state_machine
        self._audio_sink = audio_sink
        self._audio = SentenceAudioAccumulator()
        # Contexts with audio in flight. Usually one; more when a brain runs
        # several inferences inside a single stretch of bot speech.
        self._open_ctxs: list[str] = []
        # Contexts whose first sentence has already been handed over as a prefix
        # (see `_accumulate`). One entry per turn, cleared with the turn.
        self._partial_sent: set[str] = set()
        # Everything said before this processor saw its own StartFrame.
        # `push_frame()` drops frames until then — silently for the caller, and
        # noisily in the log — and the browser's `client-ready` genuinely does
        # beat the StartFrame down the pipeline (observed in the compat suite:
        # the RTVI data channel is up while StartFrame is still at the STT).
        # The resync it triggers is the widget's whole opening pose, so it is
        # held rather than lost. Bounded because a session that never starts
        # must not accumulate: the newest state is the true one, so the oldest
        # is what a full buffer drops.
        self._before_start: deque[AvatarMessage] = deque(maxlen=_PRESTART_BUFFER)
        self._started = False

    # ─── Introspection ──────────────────────────────────────────────────

    @property
    def machine(self) -> AvatarStateMachine:
        return self._machine

    @property
    def audio_sink(self) -> SentenceAudioSink | None:
        return self._audio_sink

    def set_audio_sink(self, sink: SentenceAudioSink | None) -> None:
        """Attach the viseme engine after construction (the session builds the
        processor first and the engine only if the flag and the binary allow)."""
        self._audio_sink = sink

    @property
    def ctx(self) -> str:
        """The inference context now in flight — the key a cue chunk must carry
        to be spliced into the right turn. Opaque to the widget; the state
        machine mints it (see `AvatarStateMachine.next_ctx`)."""
        return self._machine.ctx

    # ─── The pipeline ───────────────────────────────────────────────────

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            # StartFrame goes first, always: push_frame() silently drops
            # everything until this processor has seen its own start.
            await self.push_frame(frame, direction)
            self._started = True
            held, self._before_start = list(self._before_start), deque(maxlen=_PRESTART_BUFFER)
            # `start()` first: it is the pipeline's own beginning, and it dedups
            # against whatever a held resync already announced, so the state is
            # never said twice.
            await self._emit([*self._machine.start(), *held])
            return

        if isinstance(frame, SentenceBoundaryFrame):
            # Ours, addressed to ourselves. It exists to occupy a position in
            # this queue and must not travel any further.
            await self._cut_sentence(frame)
            return

        if isinstance(frame, TTSAudioRawFrame):
            await self._accumulate(frame)
        elif isinstance(frame, TTSStoppedFrame):
            # Generation for this context is over — its last sentence has been
            # cut. Playout has not finished (that is BotStoppedSpeaking, below),
            # so this ends nothing; it only tells the viseme engine that the
            # cue track it is building will not grow again.
            await self._close_context(frame)
        elif isinstance(frame, InterruptionFrame | BotStoppedSpeakingFrame):
            # A turn ends at playout, cleanly or cut. Either way its remaining
            # cues describe audio that will never be heard.
            await self._end_turns()
        elif isinstance(frame, EndFrame | CancelFrame):
            await self._end_turns()

        # Decide before forwarding (the decision is pure and cheap), forward,
        # then emit — so the avatar never sits between a frame and its
        # destination.
        messages = self._machine.on_frame(frame)
        await self.push_frame(frame, direction)
        await self._emit(messages)

    # ─── Sentence audio ─────────────────────────────────────────────────

    async def _accumulate(self, frame: TTSAudioRawFrame) -> None:
        sink = self._audio_sink
        if sink is None:
            return
        ctx = frame.context_id or self._machine.ctx
        if ctx not in self._open_ctxs:
            self._open_ctxs.append(ctx)
        self._audio.add(ctx, frame.audio)

        # The turn's first sentence is the only one that genuinely plays
        # predicted cues — generation outruns playout, so by sentence two the
        # accurate leg is already ahead. Waiting for that sentence's boundary
        # means the whole of it, however long, is spoken off an estimated
        # duration. So once enough of it exists, hand the prefix over and let the
        # engine splice real recognition in behind the playhead.
        #
        # At most one partial per context, and only before its first boundary:
        # `take()` resets the buffer at each cut, so without the flag every later
        # sentence would trip the same threshold, and none of them needs it.
        if ctx not in self._partial_sent and self._audio.pending(ctx) >= EARLY_PARTIAL_BYTES:
            self._partial_sent.add(ctx)
            await sink.on_sentence_partial(ctx, self._audio.peek(ctx))

    async def _cut_sentence(self, frame: SentenceBoundaryFrame) -> None:
        sink = self._audio_sink
        if sink is None:
            return
        pcm = self._audio.take(frame.context_id)
        if not pcm:
            # The sentence's bytes were dropped by an interruption, or the TTS
            # produced timestamps for audio we never saw. Nothing to recognise.
            return
        await sink.on_sentence_audio(frame.context_id, pcm, frame.word_timestamps)

    async def _close_context(self, frame: TTSStoppedFrame) -> None:
        """No more sentences will be queued on this context.

        This is a usable end-of-context signal only because of *where*
        `TTSStoppedFrame` sits in the queue: services that carry a `context_id`
        append it to the audio context rather than pushing it beside the audio,
        so it drains in playback order — strictly behind the last sentence's
        samples and behind the word timestamps that trigger that sentence's
        boundary. Every cut for this turn is therefore already queued at the
        engine when it arrives. A service that pushes it out of band closes the
        context early; the cost is the tail of the last sentence falling back to
        the fast leg's estimate, not a broken turn.
        """
        sink = self._audio_sink
        if sink is None:
            return
        await sink.on_context_closed(frame.context_id or self._machine.ctx)

    async def _end_turns(self) -> None:
        ctxs, self._open_ctxs = self._open_ctxs, []
        self._partial_sent.clear()
        self._audio.clear()
        sink = self._audio_sink
        if sink is None:
            return
        for ctx in ctxs:
            await sink.end_turn(ctx)

    # ─── Seams for the rest of the session ──────────────────────────────

    async def on_client_ready(self) -> None:
        """The browser finished RTVI handshake. Re-announce the current state —
        everything sent before the data channel existed went nowhere."""
        await self._emit(self._machine.resync())

    async def on_eager_end_of_turn(self) -> None:
        """An endpointer predicted the user's turn is about to end.

        Call this from whatever produces the prediction — on the STT services
        that have it, it is an event handler rather than a frame. The widget's
        listening engine may place a backchannel on that pause immediately
        instead of waiting out its own window; a wrong prediction costs a nod,
        which is why it travels as a hint.
        """
        await self._emit(self._machine.eager_end_of_turn())

    async def on_sentence_queued(self, ctx: str) -> None:
        """A sentence's text reached the TTS websocket. Claim the floor.

        The anticipation moment — see `AvatarStateMachine.sentence_queued`. The
        first-`TTSAudioRawFrame` trigger stays as the fallback for a TTS service
        that never calls this; the claim dedups, so both firing is free.
        """
        await self._emit(self._machine.sentence_queued(ctx))

    async def on_sentence_boundary(
        self, ctx: str, word_timestamps: Sequence[tuple[str, float]]
    ) -> None:
        """That sentence's audio is complete — cut the accumulator here.

        Deliberately *queues* rather than acts. The hook fires from the TTS
        service's drain loop, which has only enqueued those audio frames at this
        processor's input; slicing now would charge whatever has not been
        handled yet to the next sentence, and the error compounds down the turn.
        Queued, the cut lands in position behind its own audio.
        """
        if self._audio_sink is None:
            return
        await self.queue_frame(
            SentenceBoundaryFrame(context_id=ctx, word_timestamps=list(word_timestamps)),
            FrameDirection.DOWNSTREAM,
        )

    async def on_error(self, *, fatal: bool = False) -> None:
        """A failure the session's observer saw. `ErrorFrame`s travel upstream,
        so they never reach this seat as frames."""
        await self._emit(self._machine.error(fatal=fatal))

    async def push_cues(
        self,
        *,
        ctx: str,
        from_ms: int,
        cues: list[dict[str, Any]],
        final: bool = False,
    ) -> None:
        """The viseme seam — the engine calls this and nothing else.

        Cue chunks are client-anchored: `t` is relative to the turn's first
        audio sample, and the widget schedules them against its own clock from
        the `speech start` anchor. `from_ms` is the splice point, which is what
        lets the accurate (rhubarb) leg overwrite the fast (textsync) leg's
        not-yet-played tail invisibly.
        """
        await self._emit([AvatarMessage.cues(ctx=ctx, from_ms=from_ms, cues=cues, final=final)])

    async def send(self, message: AvatarMessage) -> None:
        """Emit one arbitrary avatar command.

        The escape hatch for callers *outside* the pipeline — an agent
        supervisor, an HTTP handler, a future verb. Code that is already inside
        the pipeline should push an `AvatarControlFrame` instead, so its
        instruction stays ordered against the speech it belongs to; this method
        emits immediately and jumps whatever is queued. Everything still goes
        through `AvatarMessage`, so no caller invents an envelope.
        """
        await self._emit([message])

    # ─── Emission ───────────────────────────────────────────────────────

    async def _emit(self, messages: Sequence[AvatarMessage]) -> None:
        for message in messages:
            if not self._started:
                self._before_start.append(message)
                continue
            wire = message.to_wire()
            logger.debug("avatar: {}", wire)
            # DOWNSTREAM, never upstream — see the module docstring. The
            # observer delivers either way, and upstream hands the frame to
            # whatever is above this seat, which is how the first deployment
            # deadlocked.
            await self.push_frame(
                RTVIServerMessageFrame(data=wire),
                FrameDirection.DOWNSTREAM,
            )
