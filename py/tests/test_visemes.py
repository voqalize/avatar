"""The two-leg engine: what each leg emits, and how the accurate one takes over.

The accurate leg used to be a batch decode of a finished sentence, which meant
its tests could hand the engine one blob and assert on one emission. It is a live
decode now, so the shape of a test here is: feed the audio in the frames a real
TTS sends (200 ms, 500 ms), and assert on the *sequence* of emissions —
principally that recognition arrives while audio is still arriving, and that each
emission is a whole track from its splice point rather than a delta.

The pure functions (`normalize_cues`, `clip_track`, `lead_track`, `wire_ms`) are
tested directly; everything else runs the real library through a real
`VisemeEngine`, with a recorder standing in for `AvatarProcessor`'s emitter. The
recorder is the only seam — it is an async callable that appends, which is what
the contract says an emitter is.

**The fixture clips carry a real pad.** They came from a service that appends
250 ms of silence to every sentence, and `PAD_BYTES` is that silence — real and
zeroed, spliced onto the clips the way the service sends it. The engine is told
nothing about it: the pad is wire time like any other, and recognition returns
`X` for it. Several tests assert on offsets that include it, which is the point.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

import pytest

from voqalize_avatar.durations import estimate_duration_ms
from voqalize_avatar.avatarsync import (
    VISEME_LETTERS,
    AvatarsyncEngine,
    AvatarsyncPaths,
    Cue,
)
from voqalize_avatar.visemes import (
    FAST_LEAD_MS,
    HOLD_BACK_MS,
    LATCH_MIN_MS,
    MIN_CUE_MS,
    VisemeEngine,
    clip_track,
    cues_to_wire,
    lead_track,
    normalize_cues,
    wire_ms,
)

from .conftest import load_clip

CTX = "7.1"
RATE = 24000

# The fixture service's silence between sentences: real zeroed PCM, spliced on
# the way it arrives. Nothing declares it to the engine.
FIXTURE_PAD_MS = 250
PAD_BYTES = b"\x00" * (FIXTURE_PAD_MS * RATE // 1000 * 2)


@dataclass
class Emission:
    ctx: str
    from_ms: int
    cues: list[Cue]
    final: bool


class Recorder:
    """The `emit` callback, reduced to what the contract requires."""

    def __init__(self) -> None:
        self.calls: list[Emission] = []

    async def __call__(self, ctx: str, from_ms: int, cues: list[Cue], final: bool) -> None:
        self.calls.append(Emission(ctx, from_ms, list(cues), final))


async def feed(
    engine: VisemeEngine, pcm: bytes, *, ctx: str = CTX, chunk_ms: int = 200, rate: int = RATE
) -> None:
    """Hand audio over the way a TTS service does: in frames, as it is generated.

    200 ms is what vql-speech sends; 500 ms is pipecat's own `TTSService`
    chunking, which is what a Google or Cartesia turn looks like.
    """
    step = chunk_ms * rate // 1000 * 2
    for at in range(0, len(pcm), step):
        await engine.on_audio(ctx, pcm[at : at + step], sample_rate=rate)
    await engine.flush(ctx)


def frames(cues: list[Cue], span_ms: int, step_ms: int = 10) -> list[str]:
    """Sample a cue track the way the widget plays it: hold until the next cue."""
    if not cues:
        return ["X"] * (span_ms // step_ms)
    out: list[str] = []
    i = 0
    for t in range(0, span_ms, step_ms):
        while i + 1 < len(cues) and cues[i + 1].t <= t:
            i += 1
        out.append(cues[i].v)
    return out


def assert_wire_valid(cues: list[Cue]) -> None:
    """Every invariant docs/contract-protocol.md § Speech asks of a cue track.

    Everything except closing the mouth — see `assert_wire_clean`.
    """
    assert cues, "empty cue track"
    assert all(cue.v in VISEME_LETTERS for cue in cues)
    times = [cue.t for cue in cues]
    assert times == sorted(times), "cues are not sorted"
    assert len(set(times)) == len(times), "duplicate cue times"
    assert all(b - a >= MIN_CUE_MS for a, b in pairwise(times)), (
        "a cue is shorter than the widget's minimum"
    )
    assert all(a.v != b.v for a, b in pairwise(cues)), "repeated shape"


def assert_wire_clean(cues: list[Cue]) -> None:
    """Valid, and it closes the mouth.

    Only a track nothing follows has to: a mid-turn emission ends at the
    recognition edge with more audio coming, and closing the mouth there would
    be a shut mouth over speech.
    """
    assert_wire_valid(cues)
    assert cues[-1].v == "X", "a track must close the mouth"


# ── pure functions ───────────────────────────────────────────────────────────


def test_normalize_drops_short_cues_but_lets_closures_replace() -> None:
    # B at +10ms is too short to see and is dropped; A is a closure, and a
    # closure carries more lip-reading information than whatever it collapses
    # into, so it replaces rather than disappears.
    assert normalize_cues([Cue(0, "C"), Cue(10, "B")]) == [Cue(0, "C")]
    assert normalize_cues([Cue(0, "C"), Cue(10, "A")]) == [Cue(0, "A")]


def test_normalize_sorts_dedupes_and_maps_the_unknown_to_silence() -> None:
    assert normalize_cues([Cue(100, "B"), Cue(0, "C")]) == [Cue(0, "C"), Cue(100, "B")]
    assert normalize_cues([Cue(0, "C"), Cue(100, "C"), Cue(200, "B")]) == [
        Cue(0, "C"),
        Cue(200, "B"),
    ]
    assert normalize_cues([Cue(0, "Z")]) == [Cue(0, "X")]


def test_clip_track_carries_the_shape_in_force_rather_than_dropping_it() -> None:
    """The one rule that makes overwrite-from-a-point safe.

    A track clipped to the first *change* after the splice would leave the mouth
    holding whatever preceded it — the caller has already discarded that — for as
    long as the next change takes. On a held vowel that is hundreds of ms.
    """
    track = [Cue(0, "A"), Cue(100, "E"), Cue(300, "C")]
    assert clip_track(track, 150) == [Cue(150, "E"), Cue(300, "C")]
    # Exactly on a cue keeps that cue, not the one before it.
    assert clip_track(track, 100) == [Cue(100, "E"), Cue(300, "C")]
    # Before the track begins there is nothing in force; the widget reads the
    # gap as silence, which is what it is.
    assert clip_track(track, 0) == track
    assert clip_track([], 50) == []


def test_wire_ms() -> None:
    assert wire_ms(b"\x00" * 48000) == 1000.0
    assert wire_ms(b"\x00" * 32000, 16000) == 1000.0
    # Keepalive frames are dropped in `on_audio`, and the test that they do not
    # shift the timeline drives that path rather than a helper —
    # `test_keepalives_do_not_shift_the_timeline`.


def test_cues_to_wire_shape() -> None:
    # `p` is omitted rather than sent as null when there is no phone, which is
    # most of a silence-heavy track. A client reading only `v` sees the wire it
    # always saw.
    assert cues_to_wire([Cue(0, "A"), Cue(30, "X")]) == [{"t": 0, "v": "A"}, {"t": 30, "v": "X"}]
    assert cues_to_wire([Cue(0, "A", "M"), Cue(30, "X")]) == [
        {"t": 0, "v": "A", "p": "M"},
        {"t": 30, "v": "X"},
    ]


async def test_the_wire_carries_the_phone_under_every_spoken_shape(
    aligner: AvatarsyncEngine,
) -> None:
    """End to end, through the engine the processor actually drives. The `p`
    channel is only worth having if it survives normalisation, the lead and the
    overwrite — the three places a cue is rebuilt."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, text, _ = load_clip("thank-you-for-your-time-today")

    await engine.on_sentence_queued(CTX, text)
    await feed(engine, pcm + PAD_BYTES)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)

    for call in recorder.calls:
        wire = cues_to_wire(call.cues)
        assert all(("p" in cue) == (cue["v"] != "X") for cue in wire), (
            "a phone is attached to silence, or a spoken shape lost one"
        )
    # Not every emission carries one — the final chunk covers the trailing pad,
    # which is silence — but a run that never emitted a phone would pass the
    # loop above vacuously.
    assert sum(
        "p" in cue for call in recorder.calls for cue in cues_to_wire(call.cues)
    ) > 5
    await engine.end_turn(CTX)


# ── the fast leg ─────────────────────────────────────────────────────────────


async def test_fast_leg_emits_a_clean_track_before_any_audio(aligner: AvatarsyncEngine) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    _, text, _ = load_clip("thank-you-for-your-time-today")

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)

    assert len(recorder.calls) == 1
    emission = recorder.calls[0]
    assert emission.ctx == CTX
    assert emission.from_ms == 0
    assert emission.final is False
    assert_wire_clean(emission.cues)
    assert emission.cues[0].t == 0

    # Cue density: a track this sparse is a mouth that barely moves, this dense
    # is a flutter. Measured 4-11 /s across the fixtures; the band is loose
    # enough for that spread and tight enough to catch either failure.
    est_ms = estimate_duration_ms(text)
    rate = len(emission.cues) / (est_ms / 1000)
    assert 3 <= rate <= 16, f"{rate:.1f} cues/s"
    assert emission.cues[-1].t <= est_ms


async def test_the_fast_leg_lays_sentences_end_to_end(aligner: AvatarsyncEngine) -> None:
    """Predicted starts run on predicted speech, and nothing else.

    A sentence with no audio yet can only be placed from the estimate of the one
    before it. This is the *only* place a pad could have been budgeted, and it
    is deliberately not: any silence the service appends shows up when the audio
    arrives and re-places these sentences by measurement.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    first, second = "Take your time.", "That is good to hear."

    await engine.on_sentence_queued(CTX, first)
    await engine.on_sentence_queued(CTX, second)
    await engine.flush(CTX)

    assert [call.from_ms for call in recorder.calls] == [
        0,
        estimate_duration_ms(first) - FAST_LEAD_MS,
    ]


async def test_a_dead_runtime_costs_cues_not_the_turn(tmp_path: Path) -> None:
    # AvatarsyncUnavailableError is an AvatarsyncError, so this exercises the
    # real degradation path: the leg raises, the worker logs, the turn survives.
    missing = AvatarsyncPaths(
        library=tmp_path / "nope", res_dir=tmp_path / "res", weights=None
    )
    recorder = Recorder()
    engine = VisemeEngine(recorder, AvatarsyncEngine(missing))

    await engine.on_sentence_queued(CTX, "Take your time.")
    await engine.flush(CTX)
    await engine.on_audio(CTX, b"\x00" * 9600, sample_rate=RATE)
    await engine.flush(CTX)
    await engine.on_sentence_queued(CTX, "Still here.")
    await engine.flush(CTX)

    assert recorder.calls == []
    await engine.end_turn(CTX)


# ── the lead ─────────────────────────────────────────────────────────────────


def test_lead_keeps_the_shape_in_force_at_zero_not_the_earliest() -> None:
    # B is superseded before playout begins; E is what the mouth is actually
    # doing at t=0. Clamping every cue to zero instead would keep X and then let
    # `normalize_cues` drop E as too short — the opposite of the intent.
    assert lead_track([Cue(0, "X"), Cue(20, "B"), Cue(50, "E"), Cue(200, "C")], 60) == [
        Cue(0, "E"),
        Cue(140, "C"),
    ]
    # Past the clamp it is a plain shift, negatives and all being impossible.
    assert lead_track([Cue(100, "B"), Cue(200, "C")], 60) == [Cue(40, "B"), Cue(140, "C")]
    assert lead_track([], 60) == []


async def test_predicted_cues_go_out_early(aligner: AvatarsyncEngine) -> None:
    """The error either side of the truth is symmetric; the tolerance for it is
    not (-125 ms leading, +45 ms lagging). So the whole predicted track slides
    into the half the eye forgives."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    _, text, _ = load_clip("thank-you-for-your-time-today")
    est_ms = estimate_duration_ms(text)

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)

    unled = await aligner.text_cues(text, est_ms)
    straight = normalize_cues([*unled, Cue(est_ms, "X")])
    led = recorder.calls[0].cues

    assert led == normalize_cues(lead_track([*unled, Cue(est_ms, "X")]))
    # Past the clamp, where nothing has collapsed, it is exactly the same track
    # FAST_LEAD_MS earlier — the closing X included. Held put, that X would
    # leave the mouth open a lead longer at the end of every sentence.
    assert [cue for cue in led if cue.t >= 200] == [
        Cue(cue.t - FAST_LEAD_MS, cue.v, cue.p)
        for cue in straight
        if cue.t >= 200 + FAST_LEAD_MS
    ]
    assert led[0].t == 0, "nothing can be shown before playout starts"


# ── the accurate leg ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("chunk_ms", [200, 500])
async def test_recognition_arrives_while_the_audio_is_still_arriving(
    aligner: AvatarsyncEngine, chunk_ms: int
) -> None:
    """The headline of the whole rework.

    A batch leg could not answer until an utterance ended, so on a 1.6 s sentence
    the face ran on an estimate for 1.6 s. Here the first correction lands within
    a frame or two of the first sample, and there are many of them.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, text, ms = load_clip("thank-you-for-your-time-today")

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)
    assert len(recorder.calls) == 1, "the predicted leg is supposed to go first"

    await feed(engine, pcm + PAD_BYTES, chunk_ms=chunk_ms)
    corrections = recorder.calls[1:]

    assert len(corrections) >= 2, f"only {len(corrections)} corrections in {ms} ms of audio"
    # Every one is a whole track from its splice point, and they walk forward.
    splices = [call.from_ms for call in corrections]
    assert splices == sorted(splices)
    assert splices[0] < ms // 2, f"first correction at {splices[0]} ms of a {ms} ms clip"
    for call in corrections:
        assert call.final is False
        assert all(cue.t >= call.from_ms for cue in call.cues)
        assert_wire_valid(call.cues)

    await engine.end_turn(CTX)


async def test_the_accurate_edge_stays_behind_the_fed_edge(aligner: AvatarsyncEngine) -> None:
    """The hold-back, observed from outside.

    A live phone loop backtraces from the current frame and its tail still moves,
    so the accurate track stops `HOLD_BACK_MS` short of what has been fed. Past
    that point the emission is predicted, which is why the tracks still run to
    the end of the sentence.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, text, _ = load_clip("that-is-good-to-hear")
    audio = pcm + PAD_BYTES

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)

    step = 200 * RATE // 1000 * 2
    fed_ms = 0.0
    for at in range(0, len(audio), step):
        chunk = audio[at : at + step]
        await engine.on_audio(CTX, chunk, sample_rate=RATE)
        await engine.flush(CTX)
        fed_ms += wire_ms(chunk)
        # The splice point is where the *previous* emission's recognition
        # stopped, so it is at least one hold-back behind the audio counted so far.
        assert recorder.calls[-1].from_ms <= fed_ms - HOLD_BACK_MS + 1

    await engine.end_turn(CTX)


async def test_each_correction_replaces_the_whole_track_after_its_splice(
    aligner: AvatarsyncEngine,
) -> None:
    """Overwrite, not merge — including the predicted tail.

    `from_ms` means "discard queued cues at or after this, then append these", so
    an emission that carried only the newly recognised part would silently delete
    the predicted cues covering the audio that has not been generated yet. Every
    correction re-appends them.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, first, _ = load_clip("take-your-time")
    second = "That is good to hear."

    await engine.on_sentence_queued(CTX, first)
    await engine.on_sentence_queued(CTX, second)
    await engine.flush(CTX)

    # Only the first sentence's audio: the second is still purely predicted.
    await feed(engine, pcm + PAD_BYTES)

    last = recorder.calls[-1]
    est_second = estimate_duration_ms(second)
    assert last.cues[-1].t > last.from_ms + est_second / 2, (
        "the correction dropped the predicted tail: "
        f"track ends at {last.cues[-1].t}, splice at {last.from_ms}"
    )
    assert last.cues[-1].v == "X", "the tail must still close the turn's mouth"
    await engine.end_turn(CTX)


async def test_recognition_disagrees_with_the_estimate_but_not_wildly(
    aligner: AvatarsyncEngine,
) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, text, ms = load_clip("that-is-good-to-hear")

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)
    predicted = recorder.calls[0].cues

    await feed(engine, pcm + PAD_BYTES)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)
    recognised = recorder.calls[-1].cues

    # The two legs must disagree — a predicted leg that matched recognition
    # exactly would mean the accurate leg is not looking at the audio — but not
    # wildly, or the takeover would be a jump rather than a correction.
    agreement = sum(
        a == b for a, b in zip(frames(predicted, ms), frames(recognised, ms), strict=True)
    ) / (ms // 10)
    assert 0.0 < agreement < 0.95, f"agreement {agreement:.2f}"
    await engine.end_turn(CTX)


async def test_a_sentence_boundary_reseats_the_sentences_behind_it(
    aligner: AvatarsyncEngine,
) -> None:
    """`on_sentence_spoken` is bookkeeping: it moves where *later* predicted
    cues are laid out, from an estimate to a measurement."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, first, true_ms = load_clip("take-your-time")
    second = "That is good to hear."

    await engine.on_sentence_queued(CTX, first)
    await engine.on_sentence_queued(CTX, second)
    await engine.flush(CTX)
    estimated_start = recorder.calls[1].from_ms

    await feed(engine, pcm + PAD_BYTES)
    await engine.on_sentence_spoken(CTX)
    await engine.flush(CTX)

    # The estimate for this clip is ~19% long, so the second sentence really
    # does move; if the fixture ever changes to one the estimator nails, the
    # re-seat is correctly invisible and this test is vacuous — hence this.
    true_start = true_ms + FIXTURE_PAD_MS - FAST_LEAD_MS
    assert estimated_start != true_start, "fixture no longer exercises the re-seat"

    # Nothing is emitted by the boundary itself; it shows up in the next
    # correction's tail, so drive one more frame of audio.
    await feed(engine, PAD_BYTES)
    tail = [cue for cue in recorder.calls[-1].cues if cue.t >= true_start]
    assert tail, f"second sentence not re-placed near {true_start}: {recorder.calls[-1].cues}"
    await engine.end_turn(CTX)


async def test_the_sample_rate_comes_off_the_frame(aligner: AvatarsyncEngine) -> None:
    """Not off the pipeline's configured output rate.

    A TTS service may synthesise at its own rate and let pipecat resample
    downstream. Reading the pipeline's number there put every cue in such a turn
    off by exactly that ratio — which is invisible in a suite where the two
    always agree, so this one makes them disagree.
    """
    recorder = Recorder()
    # The engine's fallback rate is deliberately wrong for this audio.
    engine = VisemeEngine(recorder, aligner, sample_rate=48000)
    pcm, text, ms = load_clip("take-your-time")

    await engine.on_sentence_queued(CTX, text)
    await feed(engine, pcm + PAD_BYTES, rate=RATE)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)

    # The last splice point is the accurate edge: everything fed, less one
    # hold-back. At the fallback rate it would be half that.
    final = recorder.calls[-1]
    assert final.final is True
    assert abs(final.from_ms - (ms + FIXTURE_PAD_MS - HOLD_BACK_MS)) <= 20, (
        f"turn measured {final.from_ms + HOLD_BACK_MS} ms of audio, "
        f"which is {ms + FIXTURE_PAD_MS} ms long"
    )
    await engine.end_turn(CTX)


async def test_keepalives_do_not_shift_the_timeline(aligner: AvatarsyncEngine) -> None:
    """Two-byte wire keepalives must not be counted as audio.

    Compared on `from_ms` and not on the cues themselves, deliberately. The
    resident aligner carries state between requests — pocketsphinx normalises
    cepstral means across utterances, so the *same* PCM sent to a warm decoder
    and a cold one can differ by a shape at one boundary. That is real and
    harmless, but a cue-exact comparison across two runs would be measuring
    decoder warmth, not keepalive handling.
    """
    pcm, _, _ = load_clip("take-your-time")
    audio = pcm + PAD_BYTES

    async def run(keepalives: bool) -> list[int]:
        recorder = Recorder()
        engine = VisemeEngine(recorder, aligner)
        step = 200 * RATE // 1000 * 2
        for at in range(0, len(audio), step):
            await engine.on_audio(CTX, audio[at : at + step], sample_rate=RATE)
            if keepalives:
                # What an idling wire actually looks like between frames.
                await engine.on_audio(CTX, b"\x00\x00", sample_rate=RATE)
        await engine.on_context_closed(CTX)
        await engine.flush(CTX)
        await engine.end_turn(CTX)
        return [call.from_ms for call in recorder.calls]

    assert await run(keepalives=False) == await run(keepalives=True)


# ── the end of a turn ────────────────────────────────────────────────────────


async def test_the_context_close_is_the_only_final_chunk(aligner: AvatarsyncEngine) -> None:
    """`final` says *this track is complete*, and only one thing knows that.

    An audio frame cannot: more may follow. The TTS context closing can, which
    is why the flag hangs off that and not off the last correction — the mistake
    that left it unreachable for a whole sprint.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, text, ms = load_clip("take-your-time")

    await engine.on_sentence_queued(CTX, text)
    await feed(engine, pcm + PAD_BYTES)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)

    assert [call.final for call in recorder.calls[:-1]] == [False] * (len(recorder.calls) - 1)
    last = recorder.calls[-1]
    assert last.final is True
    assert_wire_clean(last.cues)
    # The mouth is shut for the trailing pad and stays shut to the end of the
    # wire. It closes *within* the pad rather than at the end of it: the pad is
    # recognised silence, so the closing X sits where speech stopped, and there
    # is nothing after it to say twice.
    assert ms - 200 <= last.cues[-1].t <= ms + FIXTURE_PAD_MS
    assert frames(last.cues, ms + FIXTURE_PAD_MS)[-1] == "X"
    await engine.end_turn(CTX)


async def test_a_turn_with_no_audio_still_closes(aligner: AvatarsyncEngine) -> None:
    """A context that opened and produced nothing — a cancelled generation, a
    service that errored after the sentence went out. The predicted cues stand
    and something has to close the mouth past them."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    text = "Take your time."

    await engine.on_sentence_queued(CTX, text)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)

    last = recorder.calls[-1]
    assert last.final is True
    assert last.cues == [Cue(t=estimate_duration_ms(text), v="X")]
    await engine.end_turn(CTX)


async def test_an_interrupted_turn_never_claims_to_have_completed(
    aligner: AvatarsyncEngine,
) -> None:
    """A barge-in abandons the turn, so the close never runs. The widget must
    not be told a track finished when its audio was cut."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, text, _ = load_clip("take-your-time")

    await engine.on_sentence_queued(CTX, text)
    await feed(engine, pcm + PAD_BYTES)
    await engine.end_turn(CTX)
    # The close arrives anyway — TTSStoppedFrame is still in the pipeline behind
    # the interruption.
    await engine.on_context_closed(CTX)

    assert recorder.calls
    assert not any(call.final for call in recorder.calls)


async def test_end_turn_starts_the_next_turn_from_zero(aligner: AvatarsyncEngine) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)

    await engine.on_sentence_queued(CTX, "Take your time.")
    await engine.flush(CTX)
    await engine.end_turn(CTX)

    # A second turn on the same ctx starts from zero, not from where the last
    # one left off — a barge-in must not push the next turn's cues into the past.
    await engine.on_sentence_queued(CTX, "That is good to hear.")
    await engine.flush(CTX)
    assert recorder.calls[-1].from_ms == 0
    await engine.end_turn(CTX)


# ── the decoder pool ─────────────────────────────────────────────────────────


async def test_every_way_a_turn_ends_hands_the_decoder_back(
    aligner: AvatarsyncEngine,
) -> None:
    """The bounded-memory claim, from the engine's side.

    A stream is ~55 MB and one of a handful of slots held for the length of a
    turn, so a turn that ends without releasing it is a leak that survives the
    call. Three endings, and all of them must return it: closed cleanly, cut by
    a barge-in, and torn down with the session.
    """
    pcm, text, _ = load_clip("take-your-time")

    async def turn(ending: str) -> None:
        recorder = Recorder()
        # A lease, because this is the one test that closes the session engine,
        # and a session must not be able to unload the worker-wide model.
        engine = VisemeEngine(recorder, aligner.lease())
        await engine.on_sentence_queued(CTX, text)
        await feed(engine, pcm)
        assert aligner.live_streams == 1, "no decoder was ever taken"
        if ending == "closed":
            await engine.on_context_closed(CTX)
            await engine.flush(CTX)
            await engine.end_turn(CTX)
        elif ending == "interrupted":
            await engine.end_turn(CTX)
        await engine.aclose()

    for ending in ("closed", "interrupted", "session"):
        await turn(ending)
        assert aligner.live_streams == 0, f"decoder leaked on a {ending} turn"


async def test_a_refused_decoder_costs_accuracy_and_nothing_else(
    aligner: AvatarsyncEngine,
) -> None:
    """The pool ceiling is a refusal, not an error.

    Every decoder out means this turn runs on predicted cues — a degradation
    with a moving mouth, which is the whole point of having two legs.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, text, _ = load_clip("take-your-time")

    held = []
    while (stream := await aligner.open_stream(RATE)) is not None:
        held.append(stream)
    assert held, "the pool never refused; the cap is not being enforced"
    try:
        await engine.on_sentence_queued(CTX, text)
        await feed(engine, pcm + PAD_BYTES)
        await engine.on_context_closed(CTX)
        await engine.flush(CTX)
    finally:
        for stream in held:
            await stream.close()

    assert recorder.calls, "a refused decoder took the whole turn's cues with it"
    assert recorder.calls[-1].final is True
    for call in recorder.calls:
        assert_wire_clean(call.cues)
    await engine.end_turn(CTX)


async def test_a_decoder_that_falls_behind_latches_and_never_comes_back(
    aligner: AvatarsyncEngine,
) -> None:
    """The other half of the contingency: a decoder that keeps up with nothing.

    The pool refusing is the loud failure and has its own test. This is the
    quiet one — the decoder answers, correctly, too slowly. Left alone it would
    ship corrections that land after the mouth has already moved past them,
    burning a worker thread to make the face worse, so `LATCH_RTF` gives up.

    Slowness is injected rather than provoked: making a real decoder miss
    realtime needs a machine under load, which is not a test. What is asserted
    is the policy, and that it is one-way — the wrapper stops being slow
    afterwards, and the turn must *still* stay on predicted cues, because a turn
    that flipped back would show the seam at every flip.
    """

    class SlowStream:
        """A real stream with a stall in front of every decode."""

        def __init__(self, inner: object) -> None:
            self.inner = inner
            self.stall_s = 0.25

        async def feed(self, pcm: bytes) -> None:
            await asyncio.sleep(self.stall_s)
            await self.inner.feed(pcm)  # type: ignore[attr-defined]

        async def cues(self, from_ms: int, hold_back_ms: int) -> list[Cue]:
            return await self.inner.cues(from_ms, hold_back_ms)  # type: ignore[attr-defined]

        async def finish(self) -> list[Cue]:
            return await self.inner.finish()  # type: ignore[attr-defined]

        async def close(self) -> None:
            await self.inner.close()  # type: ignore[attr-defined]

    opened: list[SlowStream] = []

    class SlowRuntime:
        def __init__(self, inner: AvatarsyncEngine) -> None:
            self.inner = inner

        async def start(self) -> None:
            await self.inner.start()

        async def stop(self) -> None:
            await self.inner.stop()

        async def text_cues(self, text: str, duration_ms: int) -> list[Cue]:
            return await self.inner.text_cues(text, duration_ms)

        async def open_stream(self, sample_rate: int) -> SlowStream | None:
            inner = await self.inner.open_stream(sample_rate)
            if inner is None:
                return None
            wrapped = SlowStream(inner)
            opened.append(wrapped)
            return wrapped

    recorder = Recorder()
    engine = VisemeEngine(recorder, SlowRuntime(aligner))
    pcm, text, _ = load_clip("thank-you-for-your-time-today")

    await engine.on_sentence_queued(CTX, text)
    await feed(engine, pcm + PAD_BYTES)
    assert opened, "the turn never opened a stream"

    latched_at = len(recorder.calls)
    # `LATCH_MIN_MS` of audio has to have gone by before the ratio is allowed to
    # mean anything, so the fixture has to be long enough to reach it.
    assert wire_ms(pcm) > LATCH_MIN_MS, "fixture is too short to reach the latch window"

    # Fast again — and it must not matter.
    opened[0].stall_s = 0.0
    await feed(engine, pcm + PAD_BYTES)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)

    assert recorder.calls[-1].final is True
    for call in recorder.calls:
        assert_wire_clean(call.cues)

    # Every cue after the latch carries no phone: a phone is what recognition
    # knows and prediction does not, so its absence is the leg's signature.
    for call in recorder.calls[latched_at:]:
        assert all(cue.p is None for cue in call.cues), (
            "recognised cues reappeared after the latch; the turn un-latched"
        )
    await engine.end_turn(CTX)


@pytest.mark.parametrize("name", ["take-your-time", "thank-you-for-your-time-today"])
async def test_every_emission_is_wire_valid(aligner: AvatarsyncEngine, name: str) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, aligner)
    pcm, text, _ = load_clip(name)

    await engine.on_sentence_queued(CTX, text)
    await feed(engine, pcm + PAD_BYTES)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)

    assert recorder.calls
    for call in recorder.calls[:-1]:
        assert_wire_valid(call.cues)
    assert_wire_clean(recorder.calls[-1].cues)
    await engine.end_turn(CTX)
