"""Cutting the PCM stream back into sentences.

Every assertion here is about a byte count, because a byte count *is* a
timestamp: 48 bytes is 1 ms at 24 kHz mono s16le, and a sentence charged bytes
that belong to its neighbour moves every cue after it by the difference. The
errors are cumulative down a turn, so they are worth counting exactly rather
than approximately.
"""

from __future__ import annotations

from voqalize_avatar.sentence_audio import (
    KEEPALIVE_MAX_BYTES,
    SentenceAudioAccumulator,
    SentenceBoundaryFrame,
)


def test_a_sentence_is_everything_since_the_last_cut() -> None:
    acc = SentenceAudioAccumulator()
    acc.add("1.1", b"aaaa")
    acc.add("1.1", b"bbbb")
    assert acc.take("1.1") == b"aaaabbbb"
    acc.add("1.1", b"cccc")
    assert acc.take("1.1") == b"cccc"


def test_keepalives_are_not_audio() -> None:
    """A TTS service can hold an idle websocket open with a 2-byte chunk. Counted
    as audio it is 1/48 ms of drift per idle gap, and the drift never comes
    back."""
    acc = SentenceAudioAccumulator()
    acc.add("1.1", b"\x00" * KEEPALIVE_MAX_BYTES)
    acc.add("1.1", b"aaaa")
    acc.add("1.1", b"\x00" * KEEPALIVE_MAX_BYTES)
    assert acc.take("1.1") == b"aaaa"


def test_contexts_do_not_bleed_into_each_other() -> None:
    """Two inferences can be in flight at once; each owns its own timeline."""
    acc = SentenceAudioAccumulator()
    acc.add("1.1", b"aaaa")
    acc.add("1.2", b"bb" * 4)
    assert acc.take("1.1") == b"aaaa"
    assert acc.take("1.2") == b"bbbbbbbb"


def test_taking_an_unknown_context_is_empty_not_an_error() -> None:
    """A boundary can outlive its audio — an interruption drops the bytes and
    the marker arrives anyway."""
    assert SentenceAudioAccumulator().take("9.9") == b""


def test_dropping_a_context_forgets_it() -> None:
    acc = SentenceAudioAccumulator()
    acc.add("1.1", b"aaaa")
    acc.drop("1.1")
    assert acc.take("1.1") == b""


def test_clear_forgets_every_context() -> None:
    acc = SentenceAudioAccumulator()
    acc.add("1.1", b"aaaa")
    acc.add("1.2", b"bbbb")
    acc.clear()
    assert (acc.take("1.1"), acc.take("1.2")) == (b"", b"")


def test_a_boundary_that_never_arrives_bounds_the_buffer() -> None:
    """A TTS with no word timestamps produces no boundary at all. The failure
    should be a warning and a ceiling, not a session whose memory grows with how
    long the agent talks."""
    acc = SentenceAudioAccumulator(max_context_bytes=16)
    acc.add("1.1", b"a" * 12)
    acc.add("1.1", b"b" * 12)
    assert acc.pending("1.1") == 12


def test_the_ceiling_lifts_once_the_stream_is_cut() -> None:
    acc = SentenceAudioAccumulator(max_context_bytes=16)
    acc.add("1.1", b"a" * 12)
    acc.add("1.1", b"b" * 12)
    acc.take("1.1")
    acc.add("1.1", b"c" * 12)
    assert acc.take("1.1") == b"c" * 12


def test_the_boundary_marker_carries_its_sentence() -> None:
    frame = SentenceBoundaryFrame(context_id="1.1", word_timestamps=[("hi", 0.0)])
    assert (frame.context_id, frame.word_timestamps) == ("1.1", [("hi", 0.0)])
