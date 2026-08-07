"""Cutting one continuous PCM stream back into the sentences it was made of.

The viseme engine's accurate leg wants *a sentence's* bytes. What the avatar's
seat actually sees is a continuous stream of `TTSAudioRawFrame`s per inference
context, with nothing in them that says where one sentence ends. The only signal
that does is a per-sentence boundary hook on the TTS service (see
`wiring.SentenceHookTTS`), which fires after the last of that sentence's audio
has been pushed downstream.

So the slice is a cumulative count: everything accumulated since the previous
boundary *is* this sentence. Two things make that exact rather than
approximately right.

**Keepalives are not audio.** A streaming TTS may emit a 2-byte chunk to hold an
idle websocket open. Counting one as audio shifts every later cue by a fraction
of a millisecond, and the error is cumulative over a turn.

**The boundary has to arrive in the audio stream, not beside it.** The hook fires
from the TTS service's own drain loop, which has only *queued* those frames at
the avatar's input; the avatar may be several frames behind. Reading the counter
at that instant undercounts by however far behind it is, and the missing bytes
then get charged to the next sentence. `SentenceBoundaryFrame` closes that gap:
the processor queues it to itself, so it lands in its own input queue behind the
audio already there and is handled in position. It is a `DataFrame` for the same
reason — a `SystemFrame` would jump the queue and reintroduce exactly the race
it exists to remove.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from loguru import logger
from pipecat.frames.frames import DataFrame

# A streaming TTS websocket keepalive. `visemes.KEEPALIVE_MAX_BYTES` is the same
# number read from the other end of the pipe; they are deliberately separate
# constants because this module must not import the viseme stack (it is reached
# from the avatar barrel, which must never drag the native runtime in).
KEEPALIVE_MAX_BYTES = 2

# How much of a turn's *first* sentence has to be in hand before it is worth
# recognising a prefix of it rather than waiting for the boundary. See
# `visemes.EARLY_SPLICE_MS` for what the number is for; the two constants are
# deliberately separate for the same reason `KEEPALIVE_MAX_BYTES` is (this module
# must not import the viseme stack).
#
# 1.2 s, expressed in bytes at 24 kHz mono s16le. Generation runs ~5.8x realtime,
# so this much audio exists ~205 ms after the first sample — leaving ~250 ms of
# margin before playout reaches the 500 ms splice point. Shorter and the prefix
# barely reaches past the splice; longer and the cues stop arriving in time to be
# spliced silently.
EARLY_PARTIAL_BYTES = 1200 * 24000 * 2 // 1000

# ~60 s of 24 kHz mono s16le. A turn is a few seconds; reaching this means the
# boundary hook is not firing at all (a TTS service with no word timestamps),
# and the right failure is a warning and a bounded buffer rather than a session
# whose memory grows with how long the agent talks.
MAX_CONTEXT_BYTES = 60 * 24000 * 2


@dataclass
class SentenceBoundaryFrame(DataFrame):
    """ "That was a sentence" — placed in the audio stream at the cut point.

    Created and consumed by `AvatarProcessor`; it never travels the pipeline.
    """

    context_id: str = ""
    word_timestamps: list[tuple[str, float]] = field(default_factory=list)


class SentenceAudioAccumulator:
    """Per-context PCM, handed over one sentence at a time."""

    def __init__(self, *, max_context_bytes: int = MAX_CONTEXT_BYTES) -> None:
        self._buffers: dict[str, bytearray] = {}
        self._max = max_context_bytes
        self._warned: set[str] = set()

    def add(self, ctx: str, audio: bytes) -> None:
        """Accumulate one wire chunk. Keepalives are dropped, not counted."""
        if len(audio) <= KEEPALIVE_MAX_BYTES:
            return
        buffer = self._buffers.get(ctx)
        if buffer is None:
            buffer = bytearray()
            self._buffers[ctx] = buffer
        if len(buffer) + len(audio) > self._max:
            if ctx not in self._warned:
                self._warned.add(ctx)
                logger.warning(
                    "avatar: {} bytes of unsliced audio on ctx {} — no sentence "
                    "boundary is arriving; dropping the excess",
                    len(buffer),
                    ctx,
                )
            return
        buffer.extend(audio)

    def take(self, ctx: str) -> bytes:
        """Everything since the previous boundary, and reset the count.

        Returns empty for a context that has produced no audio — a boundary can
        fire for a sentence whose bytes were flushed by an interruption.
        """
        buffer = self._buffers.get(ctx)
        if buffer is None:
            return b""
        out = bytes(buffer)
        buffer.clear()
        self._warned.discard(ctx)
        return out

    def peek(self, ctx: str) -> bytes:
        """Everything since the previous boundary, *without* cutting.

        The early leg reads a sentence mid-flight, so it must not consume: the
        boundary still has to hand over the whole sentence when it lands, and the
        byte count is what places every later sentence on the turn's timeline.
        """
        buffer = self._buffers.get(ctx)
        return bytes(buffer) if buffer else b""

    def drop(self, ctx: str) -> None:
        """Forget a context entirely: its turn ended, cleanly or not."""
        self._buffers.pop(ctx, None)
        self._warned.discard(ctx)

    def clear(self) -> None:
        self._buffers.clear()
        self._warned.clear()

    def pending(self, ctx: str) -> int:
        """Bytes held for a context — introspection for tests and logging."""
        buffer = self._buffers.get(ctx)
        return len(buffer) if buffer else 0
