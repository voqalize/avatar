"""The two-leg engine: what each leg emits, and how the splice between them lands.

The pure functions (`normalize_cues`, `wire_ms`, `join_audio_chunks`) are tested
directly; everything else runs the real binary through a real `VisemeEngine`,
with a recorder standing in for `AvatarProcessor`'s emitter. The recorder is the
only seam — it is an async callable that appends, which is what the contract
says an emitter is.

**The fixture clips carry a real pad.** They came from a service that appends
250 ms of silence to every sentence, and `PAD_BYTES` is that silence — real and
zeroed, spliced onto the clips the way the service sends it. The engine is told
nothing about it: the pad is wire time like any other, and recognition returns
`X` for it. Several tests assert on offsets that include it, which is the point.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

import pytest

from voqalize_avatar.durations import estimate_duration_ms
from voqalize_avatar.avatarsync import (
    VISEME_LETTERS,
    Cue,
    RhubarbPaths,
    RhubarbRuntime,
)
from voqalize_avatar.visemes import (
    EARLY_SPLICE_MS,
    FAST_LEAD_MS,
    MIN_CUE_MS,
    VisemeEngine,
    cues_to_wire,
    join_audio_chunks,
    lead_track,
    normalize_cues,
    wire_ms,
)

from .conftest import load_clip

CTX = "7.1"

# The fixture service's silence between sentences: real zeroed PCM, spliced on
# the way it arrives. Nothing declares it to the engine.
FIXTURE_PAD_MS = 250
PAD_BYTES = b"\x00" * (FIXTURE_PAD_MS * 24000 // 1000 * 2)


@dataclass
class Emission:
    ctx: str
    from_ms: int
    cues: list[Cue]
    final: bool


class Recorder:
    """Sprint A's `emit` callback, reduced to what the contract requires."""

    def __init__(self) -> None:
        self.calls: list[Emission] = []

    async def __call__(self, ctx: str, from_ms: int, cues: list[Cue], final: bool) -> None:
        self.calls.append(Emission(ctx, from_ms, list(cues), final))


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


def assert_wire_clean(cues: list[Cue]) -> None:
    """Every invariant docs/contract-protocol.md § Speech asks a cue track to hold."""
    assert cues, "empty cue track"
    assert all(cue.v in VISEME_LETTERS for cue in cues)
    times = [cue.t for cue in cues]
    assert times == sorted(times), "cues are not sorted"
    assert len(set(times)) == len(times), "duplicate cue times"
    assert all(b - a >= MIN_CUE_MS for a, b in pairwise(times)), (
        "a cue is shorter than the widget's minimum"
    )
    assert all(a.v != b.v for a, b in pairwise(cues)), "repeated shape"
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


def test_wire_ms_and_keepalive_filtering() -> None:
    assert wire_ms(b"\x00" * 48000) == 1000.0
    # 2-byte keepalives are wire noise, not a 42-microsecond sample.
    assert join_audio_chunks([b"ab", b"1234", b"cd", b"5678"]) == b"12345678"


def test_cues_to_wire_shape() -> None:
    assert cues_to_wire([Cue(0, "A"), Cue(30, "X")]) == [{"t": 0, "v": "A"}, {"t": 30, "v": "X"}]


# ── the fast leg ─────────────────────────────────────────────────────────────


async def test_fast_leg_emits_a_clean_track_before_any_audio(rhubarb: RhubarbRuntime) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
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


async def test_the_fast_leg_lays_sentences_end_to_end(rhubarb: RhubarbRuntime) -> None:
    """Predicted starts run on predicted speech, and nothing else.

    A sentence with no audio yet can only be placed from the estimate of the one
    before it. This is the *only* place a pad could have been budgeted, and it
    is deliberately not: any silence the service appends shows up when the audio
    arrives and re-places these sentences by measurement.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    first, second = "Take your time.", "That is good to hear."

    await engine.on_sentence_queued(CTX, first)
    await engine.on_sentence_queued(CTX, second)
    await engine.flush(CTX)

    assert [call.from_ms for call in recorder.calls] == [
        0,
        estimate_duration_ms(first) - FAST_LEAD_MS,
    ]


async def test_a_dead_runtime_costs_cues_not_the_turn(tmp_path: Path) -> None:
    # RhubarbUnavailableError is a RhubarbError, so this exercises the real
    # degradation path: the leg raises, the worker logs, the turn survives.
    missing = RhubarbPaths(binary=tmp_path / "nope", res_dir=tmp_path / "res", weights=None)
    recorder = Recorder()
    engine = VisemeEngine(recorder, RhubarbRuntime(missing))

    await engine.on_sentence_queued(CTX, "Take your time.")
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


async def test_predicted_cues_go_out_early(rhubarb: RhubarbRuntime) -> None:
    """The error either side of the truth is symmetric; the tolerance for it is
    not (-125 ms leading, +45 ms lagging). So the whole predicted track slides
    into the half the eye forgives."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    _, text, _ = load_clip("thank-you-for-your-time-today")
    est_ms = estimate_duration_ms(text)

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)

    unled = await rhubarb.text_cues(text, est_ms)
    straight = normalize_cues([*unled, Cue(est_ms, "X")])
    led = recorder.calls[0].cues

    assert led == normalize_cues(lead_track([*unled, Cue(est_ms, "X")]))
    # Past the clamp, where nothing has collapsed, it is exactly the same track
    # FAST_LEAD_MS earlier — the closing X included. Held put, that X would
    # leave the mouth open a lead longer at the end of every sentence.
    assert [cue for cue in led if cue.t >= 200] == [
        Cue(cue.t - FAST_LEAD_MS, cue.v) for cue in straight if cue.t >= 200 + FAST_LEAD_MS
    ]
    assert led[0].t == 0, "nothing can be shown before playout starts"


async def test_recognised_cues_do_not_lead(rhubarb: RhubarbRuntime) -> None:
    """The accurate leg's times were measured against the audio they describe.
    Shifting those would introduce the error the lead exists to move."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, first, true_ms = load_clip("take-your-time")

    await engine.on_sentence_queued(CTX, first)
    await engine.on_sentence_queued(CTX, "That is good to hear.")
    await engine.flush(CTX)
    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.flush(CTX)

    measured = [call for call in recorder.calls if call.from_ms in (0, true_ms)]
    assert len(measured) >= 2, f"no chunk landed on a measured boundary: {recorder.calls}"
    # The second sentence starts exactly one wire length in — not one wire
    # length less a lead.
    assert any(call.from_ms == true_ms + FIXTURE_PAD_MS for call in recorder.calls)


# ── the audio leg and the splice ─────────────────────────────────────────────


async def test_audio_leg_corrects_the_fast_leg_from_the_splice_point(
    rhubarb: RhubarbRuntime,
) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, text, ms = load_clip("that-is-good-to-hear")

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)
    fast = recorder.calls[0].cues

    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.flush(CTX)

    assert len(recorder.calls) == 2
    accurate = recorder.calls[1]
    assert accurate.from_ms == 0
    # A sentence's chunk is never final — a later sentence may still re-place it.
    assert accurate.final is False
    assert_wire_clean(accurate.cues)
    # from_ms means "discard queued cues at or after this and append these", so
    # nothing may land before the splice point.
    assert all(cue.t >= accurate.from_ms for cue in accurate.cues)

    # The two legs must disagree — a fast leg that matched recognition exactly
    # would mean the audio leg is not looking at the audio — but not wildly, or
    # the splice would be a visible jump rather than a correction.
    agreement = sum(
        a == b for a, b in zip(frames(fast, ms), frames(accurate.cues, ms), strict=True)
    ) / (ms // 10)
    assert 0.0 < agreement < 0.95, f"agreement {agreement:.2f}"


async def test_splice_reseats_the_sentences_behind_it(rhubarb: RhubarbRuntime) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, first, true_ms = load_clip("take-your-time")
    second = "That is good to hear."

    await engine.on_sentence_queued(CTX, first)
    await engine.on_sentence_queued(CTX, second)
    await engine.flush(CTX)
    estimated_start = recorder.calls[1].from_ms

    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.flush(CTX)

    # Where the second sentence's predicted cues go once the first is measured:
    # one pad past the true speech, less the lead every predicted track carries.
    true_start = true_ms + FIXTURE_PAD_MS - FAST_LEAD_MS
    # The estimate for this clip is ~19% long, so the second sentence really did
    # move; if the fixture ever changes to one the estimator nails, the re-emit
    # is correctly silent and this test is vacuous — hence the assertion.
    assert estimated_start != true_start, "fixture no longer exercises the re-seat"

    reseated = [call for call in recorder.calls[2:] if call.from_ms == true_start]
    assert reseated, f"second sentence not re-placed at {true_start}: {recorder.calls}"
    assert_wire_clean(reseated[-1].cues)
    assert reseated[-1].cues[0].t == true_start


async def test_one_chunk_can_retire_every_sentence_it_covers(rhubarb: RhubarbRuntime) -> None:
    """A TTS with no word timestamps offers no cut until the end of generation,
    so the whole turn arrives as one chunk. Every sentence it covers is now
    resolved by measurement — leaving any of them pending would re-emit its
    predicted cues at an offset already spoken."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, first, _ = load_clip("take-your-time")

    await engine.on_sentence_queued(CTX, first)
    await engine.on_sentence_queued(CTX, "That is good to hear.")
    await engine.flush(CTX)
    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES, sentences=None)
    await engine.flush(CTX)

    # Nothing predicted is left to re-place: the last emission is the measured
    # chunk itself, at the turn's start.
    assert recorder.calls[-1].from_ms == 0
    assert_wire_clean(recorder.calls[-1].cues)


async def test_offsets_accumulate_over_wire_bytes_including_the_pad(
    rhubarb: RhubarbRuntime,
) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    first_pcm, _, first_ms = load_clip("take-your-time")
    second_pcm, _, _ = load_clip("that-is-good-to-hear")

    await engine.on_sentence_audio(CTX, first_pcm + PAD_BYTES)
    await engine.flush(CTX)
    await engine.on_sentence_audio(CTX, second_pcm + PAD_BYTES)
    await engine.flush(CTX)

    assert [call.from_ms for call in recorder.calls] == [0, first_ms + FIXTURE_PAD_MS]
    # The pad plays as silence, so the first sentence must close its mouth
    # before the second starts rather than holding the last shape across it.
    assert recorder.calls[0].cues[-1].v == "X"
    assert recorder.calls[0].cues[-1].t <= first_ms


async def test_keepalives_do_not_shift_the_timeline(rhubarb: RhubarbRuntime) -> None:
    """Two-byte wire keepalives must not be counted as audio.

    Compared on `from_ms` and not on the cues themselves, deliberately. The
    resident aligner carries state between requests — pocketsphinx normalises
    cepstral means across utterances, so the *same* PCM sent to a warm process
    and a cold one can differ by a shape at one boundary. That is real and
    harmless (the leg it feeds is the corrective one), but it means a cue-exact
    comparison across two sequential runs would be measuring process warmth, not
    keepalive handling. The byte-level invariant is
    `test_sentence_audio.test_keepalives_are_not_audio`; what is left to prove
    here is that the timeline does not move.
    """
    pcm, _, _ = load_clip("take-your-time")
    second_pcm, _, _ = load_clip("that-is-good-to-hear")

    async def run(chunked: bool) -> list[Emission]:
        recorder = Recorder()
        engine = VisemeEngine(recorder, rhubarb)
        for audio in (pcm + PAD_BYTES, second_pcm + PAD_BYTES):
            if chunked:
                # 200 ms wire chunks with a 2-byte keepalive between each, which
                # is what an idling wire actually looks like.
                chunks: list[bytes] = []
                for i in range(0, len(audio), 9600):
                    chunks += [audio[i : i + 9600], b"\x00\x00"]
                await engine.on_sentence_audio(CTX, chunks)
            else:
                await engine.on_sentence_audio(CTX, audio)
        await engine.flush(CTX)
        await engine.end_turn(CTX)
        return recorder.calls

    contiguous = await run(chunked=False)
    with_keepalives = await run(chunked=True)

    assert [c.from_ms for c in contiguous] == [c.from_ms for c in with_keepalives]
    assert len(contiguous) == len(with_keepalives)


# ── the end of a turn ────────────────────────────────────────────────────────


async def test_the_context_close_is_the_only_final_chunk(rhubarb: RhubarbRuntime) -> None:
    """`final` says *this track is complete*, and only one thing knows that.

    A sentence cannot: a later one may still re-place it. The TTS context
    closing can, which is why the flag hangs off that and not off the last
    audio leg — the mistake that left it unreachable for a whole sprint.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, text, ms = load_clip("take-your-time")

    await engine.on_sentence_queued(CTX, text)
    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)

    assert [call.final for call in recorder.calls[:-1]] == [False] * (len(recorder.calls) - 1)
    last = recorder.calls[-1]
    assert last.final is True
    # It lands the end of the turn's *wire* — one pad past the last sentence's
    # speech, a moment no sentence chunk ever places.
    assert last.from_ms == ms + FIXTURE_PAD_MS
    assert last.cues == [Cue(t=last.from_ms, v="X")]


async def test_an_interrupted_turn_never_claims_to_have_completed(
    rhubarb: RhubarbRuntime,
) -> None:
    """A barge-in cancels the turn's worker, so the close never runs. The widget
    must not be told a track finished when its audio was cut."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, text, _ = load_clip("take-your-time")

    await engine.on_sentence_queued(CTX, text)
    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.flush(CTX)
    await engine.end_turn(CTX)
    # The close arrives anyway — TTSStoppedFrame is still in the pipeline behind
    # the interruption.
    await engine.on_context_closed(CTX)

    assert recorder.calls
    assert not any(call.final for call in recorder.calls)


async def test_end_turn_stops_the_worker(rhubarb: RhubarbRuntime) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)

    await engine.on_sentence_queued(CTX, "Take your time.")
    await engine.flush(CTX)
    await engine.end_turn(CTX)

    # A second turn on the same ctx starts from zero, not from where the last
    # one left off — a barge-in must not push the next turn's cues into the past.
    await engine.on_sentence_queued(CTX, "That is good to hear.")
    await engine.flush(CTX)
    assert recorder.calls[-1].from_ms == 0


# ── the early leg ────────────────────────────────────────────────────────────


def prefix_of(pcm: bytes, ms: int) -> bytes:
    """The first `ms` of a clip, at 24 kHz mono s16le."""
    return pcm[: ms * 24000 // 1000 * 2]


async def test_the_early_leg_replaces_predicted_cues_behind_the_playhead(
    rhubarb: RhubarbRuntime,
) -> None:
    """The whole point: the first sentence stops being predicted after 500 ms.

    Everything before `EARLY_SPLICE_MS` is left alone — it is either already
    played or about to be, and rewriting it would be a twitch rather than a
    correction.
    """
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, text, _ = load_clip("thank-you-for-your-time-today")

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)
    fast = recorder.calls[0].cues

    await engine.on_sentence_partial(CTX, prefix_of(pcm, 1200))
    await engine.flush(CTX)

    early = recorder.calls[1]
    end_ms = 1200 - 100  # the prefix, less EARLY_TAIL_GUARD_MS
    assert early.from_ms == EARLY_SPLICE_MS
    assert early.final is False
    assert early.cues[0].t == EARLY_SPLICE_MS
    # Deliberately NOT wire-clean. Every other chunk closes with an X at its own
    # end; this one must not, because the sentence is mid-word — a closing X here
    # shuts the mouth until the boundary lands. Nothing sits at `end_ms`.
    assert all(cue.t < end_ms for cue in early.cues)

    # It really is recognition, not the same prediction re-sent.
    played = frames(early.cues, end_ms)[EARLY_SPLICE_MS // 10 :]
    predicted = frames(fast, end_ms)[EARLY_SPLICE_MS // 10 :]
    assert played != predicted


async def test_the_early_leg_puts_the_predicted_tail_back(rhubarb: RhubarbRuntime) -> None:
    """A splice discards every queued cue at or after `from_ms` — including the
    rest of this sentence and every sentence after it. They have to come back,
    or the mouth stops moving between the prefix and the boundary."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, first, _ = load_clip("thank-you-for-your-time-today")
    second = "That is good to hear."

    await engine.on_sentence_queued(CTX, first)
    await engine.on_sentence_queued(CTX, second)
    await engine.flush(CTX)
    baseline = len(recorder.calls)

    await engine.on_sentence_partial(CTX, prefix_of(pcm, 1200))
    await engine.flush(CTX)

    resumed = recorder.calls[baseline + 1 :]
    assert resumed, "the early splice cut the tail and never restored it"
    # The first sentence's own tail, from where recognition stopped trusting
    # itself, and then the second sentence at the offset it always had.
    assert resumed[0].from_ms == 1200 - 100
    assert resumed[0].cues[-1].v == "X"
    # Still an estimate, and an estimate is speech only — the fixture's pad is
    # not budgeted for here, it arrives with the audio and re-places this
    # sentence by measurement.
    second_start = estimate_duration_ms(first) - FAST_LEAD_MS
    assert [call.from_ms for call in resumed[1:]] == [second_start]


async def test_the_early_leg_resolves_nothing(rhubarb: RhubarbRuntime) -> None:
    """It corrects cues; it must not move the turn's clock. The byte count is
    what places every later sentence, and a prefix is not a sentence."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, text, ms = load_clip("thank-you-for-your-time-today")

    await engine.on_sentence_queued(CTX, text)
    await engine.on_sentence_partial(CTX, prefix_of(pcm, 1200))
    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.on_context_closed(CTX)
    await engine.flush(CTX)

    # The boundary still recognises the whole clip and still splices from zero…
    accurate = [call for call in recorder.calls if call.from_ms == 0]
    assert len(accurate) == 2, "the boundary did not re-splice the whole sentence"
    assert_wire_clean(accurate[-1].cues)
    # …and the turn ends exactly where the bytes say, one pad past the speech.
    assert recorder.calls[-1].final is True
    assert recorder.calls[-1].from_ms == ms + FIXTURE_PAD_MS


async def test_the_early_leg_runs_once_per_turn_and_only_for_sentence_one(
    rhubarb: RhubarbRuntime,
) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, text, _ = load_clip("thank-you-for-your-time-today")

    await engine.on_sentence_queued(CTX, text)
    await engine.on_sentence_partial(CTX, prefix_of(pcm, 1200))
    await engine.flush(CTX)
    after_first = len(recorder.calls)

    # A second prefix on the same turn, and a prefix arriving after a sentence
    # has already resolved: both are no-ops. Later sentences are recognised
    # before they are played — generation outruns playout — so the early leg has
    # nothing to fix there and would only churn the wire.
    await engine.on_sentence_partial(CTX, prefix_of(pcm, 1200))
    await engine.flush(CTX)
    assert len(recorder.calls) == after_first

    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.on_sentence_queued(CTX, "That is good to hear.")
    await engine.flush(CTX)
    settled = len(recorder.calls)
    await engine.on_sentence_partial(CTX, prefix_of(pcm, 1200))
    await engine.flush(CTX)
    assert len(recorder.calls) == settled


async def test_a_prefix_too_short_to_survive_the_splice_changes_nothing(
    rhubarb: RhubarbRuntime,
) -> None:
    """Below `EARLY_SPLICE_MS + guard` there is no window left to emit into, and
    a zero-width splice would delete the fast tail for nothing."""
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, text, _ = load_clip("thank-you-for-your-time-today")

    await engine.on_sentence_queued(CTX, text)
    await engine.flush(CTX)
    before = list(recorder.calls)

    await engine.on_sentence_partial(CTX, prefix_of(pcm, 560))
    await engine.flush(CTX)

    assert recorder.calls == before


@pytest.mark.parametrize("name", ["take-your-time", "thank-you-for-your-time-today"])
async def test_every_emission_is_wire_clean(rhubarb: RhubarbRuntime, name: str) -> None:
    recorder = Recorder()
    engine = VisemeEngine(recorder, rhubarb)
    pcm, text, _ = load_clip(name)

    await engine.on_sentence_queued(CTX, text)
    await engine.on_sentence_audio(CTX, pcm + PAD_BYTES)
    await engine.flush(CTX)

    assert recorder.calls
    for call in recorder.calls:
        assert_wire_clean(call.cues)
