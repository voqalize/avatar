"""Cutting one continuous PCM stream back into the chunks it was made of.

The viseme engine's accurate leg wants *a sentence's* bytes. What the avatar's
seat actually sees is a continuous stream of `TTSAudioRawFrame`s per inference
context, with nothing in them that says where one sentence ends. The signal that
does is a frame the processor watches for — `AggregatedTextProgressFrame` with an
empty `remaining_text`, or `TTSStoppedFrame` on a service without word timestamps
(see `processor.py`).

So the slice is a cumulative count: everything accumulated since the previous
cut *is* this chunk. Two things make that exact rather than approximately right.

**Keepalives are not audio.** A streaming TTS may emit a 2-byte chunk to hold an
idle websocket open. Counting one as audio shifts every later cue by a fraction
of a millisecond, and the error is cumulative over a turn.

**The cut has to arrive in the audio stream, not beside it.** Both signals do,
because both are appended to the TTS service's per-context audio queue and drain
in playback order — a progress frame is built from the word stream, and the word
entries are queued alongside the samples they describe. A signal that arrived
out of band (as the old TTS-service callback did) would fire while the avatar was
still several audio frames behind, undercharging this chunk and overcharging the
next.
"""

from __future__ import annotations

from loguru import logger

# A streaming TTS websocket keepalive. `visemes.KEEPALIVE_MAX_BYTES` is the same
# number read from the other end of the pipe; they are two constants because this
# module is the buffer and that one is the engine, and neither imports the other.
KEEPALIVE_MAX_BYTES = 2

# How much of a turn's *first* sentence has to be in hand before it is worth
# recognising a prefix of it rather than waiting for the cut. See
# `visemes.EARLY_SPLICE_MS` for what the number is for; the two constants are
# separate for the same reason `KEEPALIVE_MAX_BYTES` is.
#
# 1.2 s, expressed in bytes at 24 kHz mono s16le. Generation runs ~5.8x realtime,
# so this much audio exists ~205 ms after the first sample — leaving ~250 ms of
# margin before playout reaches the 500 ms splice point. Shorter and the prefix
# barely reaches past the splice; longer and the cues stop arriving in time to be
# spliced silently.
EARLY_PARTIAL_BYTES = 1200 * 24000 * 2 // 1000

# ~60 s of 24 kHz mono s16le. A turn is a few seconds, and a service with no
# word timestamps still cuts at `TTSStoppedFrame`; reaching this means no cut
# signal is arriving at all, and the right failure is a warning and a bounded
# buffer rather than a session whose memory grows with how long the agent talks.
MAX_CONTEXT_BYTES = 60 * 24000 * 2


class SentenceAudioAccumulator:
    """Per-context PCM, handed over one chunk at a time."""

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
                    "cut is arriving; dropping the excess",
                    len(buffer),
                    ctx,
                )
            return
        buffer.extend(audio)

    def take(self, ctx: str) -> bytes:
        """Everything since the previous cut, and reset the count.

        Returns empty for a context that has produced no audio — a cut can fire
        for a sentence whose bytes were flushed by an interruption.
        """
        buffer = self._buffers.get(ctx)
        if buffer is None:
            return b""
        out = bytes(buffer)
        buffer.clear()
        self._warned.discard(ctx)
        return out

    def peek(self, ctx: str) -> bytes:
        """Everything since the previous cut, *without* cutting.

        The early leg reads a sentence mid-flight, so it must not consume: the
        cut still has to hand over the whole sentence when it lands, and the byte
        count is what places every later sentence on the turn's timeline.
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
