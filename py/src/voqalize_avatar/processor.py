"""`AvatarProcessor` — the pipeline seat that drives the browser's talking head.

Add it between `tts` and `transport.output()` and it works:

    pipeline = Pipeline([transport.input(), stt, llm, tts, AvatarProcessor(), transport.output()])

No arguments, no wiring, no environment. That seat is chosen, not convenient: it
observes the whole conversation at *generation* speed (a post-output seat sees
data frames delayed behind the audio queue), and it can push frames, which a
pipecat observer cannot.

It consumes nothing. Every frame is forwarded unchanged; the avatar traffic
leaves as `RTVIServerMessageFrame`s, which the `RTVIObserver` turns into RTVI
`server-message`s on the way past.

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

## Everything it needs is in the frame stream

There used to be a `wiring.py` that reached into the TTS service for per-sentence
callbacks. There is nothing left to reach for — pipecat's karaoke path puts both
halves of the viseme pipeline on the wire, and has since our declared floor:

- **A sentence was handed to TTS** is `AggregatedTextFrame(will_be_spoken=True)`,
  pushed immediately before the `TTSStartedFrame` of the audio context it
  describes. That drives the fast (text-predicted) viseme leg.
  (`TTSTextFrame` subclasses it and also sets the flag — those are the
  per-word karaoke frames, and the `not isinstance` guard is what separates them.
  It is the same discriminator pipecat's own sequencer uses.)
- **That sentence's audio is complete** is `AggregatedTextProgressFrame` with an
  empty `remaining_text` — the last word of the slot. It is derived from the word
  stream, so it is appended to the same per-context audio queue as the samples and
  arrives strictly *behind* them. That is what makes the cut exact, and it is why
  the old self-queued `SentenceBoundaryFrame` is gone: the signal now travels the
  pipeline in position instead of racing it.
- **The sample rate** is `StartFrame.audio_out_sample_rate`.

A TTS service with no word timestamps emits no progress frames; there the cut
falls back to `TTSStoppedFrame`, so the turn is recognised as one chunk instead
of sentence by sentence. That costs a little accuracy in the tail of a long turn
and nothing at the head, which is where it is seen — the early leg still corrects
the opening (`visemes.py` § Why there is an early leg).

## What it does not do

It does not decide anything about the call. Pipecat's JavaScript client projects
the lifecycle it already receives. This processor supplies correlated visemes
and passes through explicit application intent as an `AvatarControlFrame` from a
processor of your own (see `frames.py`).
"""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence
from typing import Any

from loguru import logger
from pipecat.frames.frames import (
    AggregatedTextFrame,
    AggregatedTextProgressFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    EndFrame,
    Frame,
    InterruptionFrame,
    StartFrame,
    TTSAudioRawFrame,
    TTSStoppedFrame,
    TTSTextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame

from .messages import AvatarMessage
from .sentence_audio import EARLY_PARTIAL_BYTES, SentenceAudioAccumulator
from .state_machine import AvatarStateMachine
from .visemes import VisemeEngine, build_viseme_engine, cues_to_wire

# Room for a resync or two. Nothing legitimate queues more than a handful before
# the pipeline starts.
_PRESTART_BUFFER = 8


def _is_sentence_announcement(frame: Frame) -> bool:
    """The "this sentence is about to be spoken" frame, and not a karaoke word.

    `TTSTextFrame` subclasses `AggregatedTextFrame` and sets `will_be_spoken` too,
    so the negative check is doing the real work here.
    """
    return (
        isinstance(frame, AggregatedTextFrame)
        and not isinstance(frame, TTSTextFrame)
        and frame.will_be_spoken
    )


class AvatarProcessor(FrameProcessor):
    """Observes the frame stream; emits avatar commands to the browser."""

    #: Which state machine to drive. The extension seam for an application whose
    #: own frames are just its spelling of something the library already
    #: models — subclass `AvatarStateMachine`, then name it here:
    #:
    #:     class MyAvatarProcessor(AvatarProcessor):
    #:         STATE_MACHINE = MyStateMachine
    #:
    #: A class attribute rather than a constructor argument on purpose. The
    #: front door takes no arguments and must keep taking none; a second door
    #: that is a `class` statement is hard to reach for by accident.
    STATE_MACHINE: type[AvatarStateMachine] = AvatarStateMachine

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._machine = self.STATE_MACHINE()
        self._engine: VisemeEngine | None = None
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

    # ─── The pipeline ───────────────────────────────────────────────────

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            # StartFrame goes first, always: push_frame() silently drops
            # everything until this processor has seen its own start.
            await self.push_frame(frame, direction)
            self._started = True
            self._start_visemes(frame.audio_out_sample_rate)
            held, self._before_start = list(self._before_start), deque(maxlen=_PRESTART_BUFFER)
            # `start()` first: it is the pipeline's own beginning, and it dedups
            # against whatever a held resync already announced, so the state is
            # never said twice.
            await self._emit([*self._machine.start(), *held])
            return

        if _is_sentence_announcement(frame):
            await self._sentence_queued(frame)
        elif isinstance(frame, TTSAudioRawFrame):
            await self._accumulate(frame)
        elif isinstance(frame, AggregatedTextProgressFrame):
            if not frame.remaining_text.strip():
                # The slot's last word. Every sample of *this* sentence is
                # already behind us in the queue — and only this one: later
                # sentences may well have been announced already, since text runs
                # ahead of audio.
                await self._cut(frame.context_id, sentences=1)
        elif isinstance(frame, TTSStoppedFrame):
            # Generation for this context is over. Cut whatever is left — on a
            # service with no word timestamps that is the whole turn — and tell
            # the engine its cue track will not grow again. Playout has not
            # finished (that is BotStoppedSpeaking, below), so this ends nothing.
            await self._cut(frame.context_id, sentences=None)
            await self._close_context(frame)
        elif isinstance(frame, InterruptionFrame | BotStoppedSpeakingFrame | EndFrame | CancelFrame):
            # A turn ends at playout, cleanly or cut. Either way its remaining
            # cues describe audio that will never be heard.
            await self._end_turns()

        # Decide before forwarding (the decision is pure and cheap), forward,
        # then emit — so the avatar never sits between a frame and its
        # destination.
        messages = self._machine.on_frame(frame)
        await self.push_frame(frame, direction)
        await self._emit(messages)

    # ─── Visemes ────────────────────────────────────────────────────────

    def _start_visemes(self, sample_rate: int) -> None:
        """Build the lipsync engine, or run the speech channel alone.

        `build_viseme_engine` raises — it is the internal API and it fails fast,
        naming the path it could not find. This is the pipecat wrapper, and the
        wrapper's job is that a missing binary costs the call its lipsync and not
        its audio. That is the whole of the degraded experience: a face that holds
        still while it talks, on a platform we publish no wheel for.
        """
        try:
            self._engine = build_viseme_engine(
                self._push_cues, sample_rate=sample_rate
            )
        except Exception as exc:
            self._engine = None
            logger.warning(
                "avatar: server-side lipsync is off for this session — {}. The state "
                "channel still runs; the widget's mouth will not move while it speaks.",
                exc,
            )

    async def _push_cues(self, ctx: str, from_ms: int, cues: list[Any], final: bool) -> None:
        """The engine's one way out.

        Cue chunks are client-anchored: `t` is relative to the turn's first audio
        sample, and the widget schedules them against its own clock from the
        `botStartedSpeaking` anchor. `from_ms` is the splice point, which is what lets
        the accurate (rhubarb) leg overwrite the fast (textsync) leg's
        not-yet-played tail invisibly.
        """
        await self._emit(
            [AvatarMessage.cues(ctx=ctx, from_ms=from_ms, cues=cues_to_wire(cues), final=final)]
        )

    async def _sentence_queued(self, frame: AggregatedTextFrame) -> None:
        """A sentence's text reached the TTS. Predict its cues now.

        The browser's Pipecat lifecycle controller supplies any floor-taking
        presentation; this path only supplies the predicted viseme leg.
        """
        if self._engine is None:
            return
        ctx = self._context_id(frame.context_id, "sentence")
        if ctx is None:
            return
        await self._engine.on_sentence_queued(ctx, frame.text)

    async def _accumulate(self, frame: TTSAudioRawFrame) -> None:
        if self._engine is None:
            return
        ctx = self._context_id(frame.context_id, "audio")
        if ctx is None:
            return
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
        # At most one partial per context, and only before its first cut:
        # `take()` resets the buffer at each cut, so without the flag every later
        # sentence would trip the same threshold, and none of them needs it.
        if ctx not in self._partial_sent and self._audio.pending(ctx) >= EARLY_PARTIAL_BYTES:
            self._partial_sent.add(ctx)
            await self._engine.on_sentence_partial(ctx, self._audio.peek(ctx))

    async def _cut(self, context_id: str | None, *, sentences: int | None) -> None:
        """Hand everything accumulated since the last cut to the accurate leg.

        `sentences` is how many predicted sentences these bytes retire — one for
        a word-stream cut, all of them (`None`) for the end of generation, which
        is the whole turn on a service with no word timestamps.
        """
        if self._engine is None:
            return
        ctx = self._context_id(context_id, "audio cut")
        if ctx is None:
            return
        pcm = self._audio.take(ctx)
        if not pcm:
            # Nothing new since the last cut: a progress frame for a sentence
            # whose bytes an interruption already flushed, or a `TTSStoppedFrame`
            # arriving behind a word stream that cut the last sentence itself.
            return
        await self._engine.on_sentence_audio(ctx, pcm, sentences=sentences)

    async def _close_context(self, frame: TTSStoppedFrame) -> None:
        """No more sentences will be queued on this context — the track is final."""
        if self._engine is None:
            return
        ctx = self._context_id(frame.context_id, "TTS stop")
        if ctx is not None:
            await self._engine.on_context_closed(ctx)

    @staticmethod
    def _context_id(context_id: str | None, source: str) -> str | None:
        """Require the stock base-TTS context rather than inventing one.

        The client binds these contexts FIFO to Pipecat's uncorrelated browser
        speaking events. A synthetic id would make that binding look valid while
        describing unknown audio, so a non-standard TTS implementation without
        contexts deliberately loses lipsync rather than animating the wrong turn.
        """
        if context_id:
            return context_id
        logger.warning("avatar: skipping {} viseme data without a Pipecat TTS context_id", source)
        return None

    async def _end_turns(self) -> None:
        ctxs, self._open_ctxs = self._open_ctxs, []
        self._partial_sent.clear()
        self._audio.clear()
        if self._engine is None:
            return
        for ctx in ctxs:
            await self._engine.end_turn(ctx)

    # ─── Seams for the rest of the session ──────────────────────────────

    async def on_client_ready(self) -> None:
        """The browser finished the RTVI handshake. Re-announce the current state —
        everything sent before the data channel existed went nowhere.

        Wire this to your RTVI processor's `on_client_ready` event. Skipping it
        costs the widget its opening pose, nothing more.
        """
        await self._emit(self._machine.resync())

    async def send(self, message: AvatarMessage) -> None:
        """Emit one avatar command from *outside* the pipeline.

        The escape hatch for an agent supervisor or an HTTP handler — something
        with no frame to push. Code that is already inside the pipeline should
        push an `AvatarControlFrame` instead, so its instruction stays ordered
        against the speech it belongs to; this method emits immediately and jumps
        whatever is queued.
        """
        await self._emit([message])

    async def cleanup(self) -> None:
        engine, self._engine = self._engine, None
        if engine is not None:
            await engine.aclose()
        await super().cleanup()

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
