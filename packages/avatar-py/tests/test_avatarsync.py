"""The in-process aligner: round trips, phones, and the two claims that matter.

Against the real `libavatarsync`. A stub would pass all of this while telling us
nothing about the properties this module exists for — that a decode runs off the
event loop, that concurrent decodes are genuinely concurrent, and that a cue's
phone is the one under its shape rather than a plausible-looking string.
"""

from __future__ import annotations

import asyncio
import os
import re
import time

import pytest

from voqalize_avatar.avatarsync import (
    DEFAULT_WORKERS,
    VISEME_LETTERS,
    AvatarsyncEngine,
    AvatarsyncError,
    AvatarsyncPaths,
    Cue,
    platform_id,
    shared_engine,
    shift,
    stop_shared_engine,
)

from .conftest import load_clip


def test_platform_id_normalises_arch() -> None:
    # The one string that must agree across three places: this module,
    # native/avatarsync/build.sh, and the committed bin/<platform>/ directory.
    assert platform_id() in {"darwin-arm64", "linux-x64", "darwin-x64", "linux-arm64"}


async def test_the_engine_loads_a_real_model(aligner: AvatarsyncEngine) -> None:
    native = aligner._engine  # noqa: SLF001 - the numbers are not public API
    assert native is not None
    # A dictionary this size is the whole cmudict; anything much smaller means
    # the res tree was half-materialised.
    assert native.dict_entries > 100_000
    # warmup_ms near zero would mean the acoustic model never loaded and the
    # first real audio request pays ~180 ms instead of ~20. That is exactly the
    # regression the resident engine exists to prevent, so assert on it.
    assert native.warmup_ms > 10
    # Built from the library rather than hard-coded here, so a reordered enum in
    # the C++ shows up as a failure instead of as mislabelled phones.
    assert native.shape_names == ("A", "B", "C", "D", "E", "F", "G", "H", "X")
    assert "Noise" in native.phone_names


async def test_text_leg_round_trip(aligner: AvatarsyncEngine) -> None:
    cues = await aligner.text_cues("Take your time.", 830)

    assert cues, "the text leg produced no cues"
    assert all(cue.v in VISEME_LETTERS for cue in cues)
    assert [cue.t for cue in cues] == sorted(cue.t for cue in cues)
    assert cues[0].t == 0
    assert cues[-1].t <= 830


async def test_audio_leg_round_trip(aligner: AvatarsyncEngine) -> None:
    pcm, _, ms = load_clip("that-is-good-to-hear")

    cues = await aligner.audio_cues(pcm)

    assert cues
    assert all(cue.v in VISEME_LETTERS for cue in cues)
    assert cues[-1].t <= ms


@pytest.mark.parametrize("leg", ["text", "audio"])
async def test_every_cue_carries_the_phone_under_its_shape(
    aligner: AvatarsyncEngine, leg: str
) -> None:
    """The `p` channel, which is the reason the C ABI returns a struct and not a
    letter. Both legs hold a phone timeline; neither may drop it.

    Silence is the one shape with no phone, and structurally so: `X` comes from a
    *gap* in the phone timeline, so there is nothing under it to name. `Noise` is
    a phone in its own right and maps to `B`, not `X` — a silent cue carrying a
    phone would mean the zip picked up a neighbour's.
    """
    native = aligner._engine  # noqa: SLF001
    assert native is not None
    pcm, text, ms = load_clip("thank-you-for-your-time-today")

    cues = await (aligner.text_cues(text, ms) if leg == "text" else aligner.audio_cues(pcm))

    assert cues
    assert any(cue.p is not None for cue in cues), "no cue carried a phone"
    for cue in cues:
        if cue.v == "X":
            assert cue.p is None, f"silence at {cue.t}ms claims phone {cue.p}"
        else:
            assert cue.p in native.phone_names, f"{cue.p!r} is not a phone"


async def test_the_engine_outlives_requests(aligner: AvatarsyncEngine) -> None:
    native = aligner._engine  # noqa: SLF001
    for _ in range(5):
        assert await aligner.text_cues("One moment.", 600)
    # The same loaded model throughout — the 82 MB is paid once, which is the
    # entire reason this is an object and not a function.
    assert aligner._engine is native  # noqa: SLF001


async def test_concurrent_requests_do_not_cross_wires(aligner: AvatarsyncEngine) -> None:
    # Durations far enough apart that a mis-correlated response is unmistakable:
    # a 400 ms track cannot be confused with a 3200 ms one.
    durations = [400, 800, 1200, 1600, 2000, 2400, 2800, 3200]

    results = await asyncio.gather(
        *(aligner.text_cues("Thanks for sharing that with me.", ms) for ms in durations)
    )

    for ms, cues in zip(durations, results, strict=True):
        assert cues, f"no cues for {ms}ms"
        assert cues[-1].t <= ms
        # The last cue lands in the back half of the clip — enough to pin the
        # response to its own duration and not a neighbour's.
        assert cues[-1].t > ms * 0.4


async def test_empty_input_never_reaches_the_library(aligner: AvatarsyncEngine) -> None:
    assert await aligner.text_cues("Hello.", 0) == []
    assert await aligner.audio_cues(b"") == []


async def test_a_decode_does_not_block_the_event_loop(aligner: AvatarsyncEngine) -> None:
    """The claim the whole ctypes design rests on.

    ctypes releases the GIL for the duration of a foreign call, so a decode on
    the executor leaves the loop free to keep moving 20 ms audio frames. If that
    were false — an extension holding the GIL, a decode accidentally awaited
    inline — this pipeline would stutter audibly and every other test here would
    still pass.
    """
    pcm, _, _ = load_clip("thank-you-for-your-time-today")
    long_clip = pcm * 8  # ~13 s of audio, ~300 ms of decode

    ticks = 0

    async def heartbeat() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.002)
            ticks += 1

    beat = asyncio.create_task(heartbeat())
    await asyncio.sleep(0.01)
    ticks = 0
    started = time.perf_counter()
    cues = await aligner.audio_cues(long_clip)
    elapsed = time.perf_counter() - started
    beat.cancel()

    assert cues
    assert elapsed > 0.1, "clip too short to prove anything; lengthen it"
    # A loop blocked for the whole decode ticks once, at the end. The bound is
    # deliberately far below what a healthy loop manages (~150 at 2 ms) so a busy
    # CI box does not fail it.
    assert ticks > 10, f"only {ticks} loop ticks during a {elapsed * 1000:.0f}ms decode"


@pytest.mark.skipif(os.cpu_count() is None or os.cpu_count() < 2, reason="needs 2 cores")
async def test_decodes_run_in_parallel(aligner: AvatarsyncEngine) -> None:
    """Two decodes at once cost about what one costs.

    The other half of the GIL claim: not just that the loop keeps running, but
    that the second worker is doing real work rather than waiting for the first
    to hand the interpreter back. Measured at 1.02x on darwin-arm64 — the two
    decodes overlap almost exactly.

    This is also the test that fails if `warmup_decoders` stops tracking the
    worker count: with one warm decoder the pool builds the second one on this
    first concurrent pair, and the pair costs ~1.95x instead.
    """
    pcm, _, _ = load_clip("thank-you-for-your-time-today")
    clip = pcm * 4

    started = time.perf_counter()
    await aligner.audio_cues(clip)
    serial = time.perf_counter() - started

    started = time.perf_counter()
    both = await asyncio.gather(aligner.audio_cues(clip), aligner.audio_cues(clip))
    concurrent = time.perf_counter() - started

    assert all(both)
    # Perfect overlap is 1.0x serial; no overlap at all is 2.0x. 1.4x leaves
    # generous room for a busy box and still fails a decode that serialised.
    assert concurrent < serial * 1.4, (
        f"two decodes took {concurrent:.3f}s against {serial:.3f}s for one — "
        "they serialised"
    )


async def test_stop_is_final(aligner_paths: AvatarsyncPaths) -> None:
    engine = AvatarsyncEngine(aligner_paths)
    await engine.start()
    await engine.stop()

    with pytest.raises(AvatarsyncError, match="closed"):
        await engine.text_cues("Anything.", 500)
    with pytest.raises(AvatarsyncError, match="closed"):
        await engine.audio_cues(b"\x00\x01" * 1000)


async def test_a_missing_library_fails_at_start_naming_the_path(tmp_path) -> None:
    paths = AvatarsyncPaths(
        library=tmp_path / "libavatarsync.dylib", res_dir=tmp_path / "res", weights=None
    )
    engine = AvatarsyncEngine(paths)

    with pytest.raises(AvatarsyncError, match=re.escape(str(tmp_path))):
        await engine.start()


@pytest.mark.parametrize("leg", ["text", "audio"])
async def test_warm_latency(aligner: AvatarsyncEngine, leg: str) -> None:
    """Both legs must stay far under a 20 ms audio frame's worth of budget.

    Measured on darwin-arm64 (M-series), median over 10 runs:
        text leg   0.15-0.5 ms
        audio leg  20-21 ms for a 937 ms clip

    The bounds below are ~4x those, loose enough to survive a busy CI box and
    tight enough to catch the regression that matters: a lost warm decoder pool
    puts the audio leg back at ~180 ms.
    """
    pcm, text, ms = load_clip("take-your-time")
    budget_ms = 5.0 if leg == "text" else 60.0

    async def once() -> None:
        if leg == "text":
            await aligner.text_cues(text, ms)
        else:
            await aligner.audio_cues(pcm)

    await once()  # discard the first: it is the executor warming, not the leg
    samples: list[float] = []
    for _ in range(10):
        started = time.perf_counter()
        await once()
        samples.append((time.perf_counter() - started) * 1000)

    samples.sort()
    median = samples[len(samples) // 2]
    assert median < budget_ms, f"{leg} leg median {median:.1f}ms exceeds {budget_ms}ms"


def test_shift_moves_a_track_onto_the_turn_timeline() -> None:
    assert shift([Cue(t=0, v="A", p="M"), Cue(t=100, v="B")], 250) == [
        Cue(t=250, v="A", p="M"),
        Cue(t=350, v="B"),
    ]


# ── the shared engine ────────────────────────────────────────────────────────


async def test_one_engine_serves_every_session(aligner_paths: AvatarsyncPaths) -> None:
    """Two sessions, one loaded model. This is the whole reason the engine is
    shared: the 86 MB acoustic model is per *decoder*, so per-session copies made
    memory scale with concurrency for no throughput at all."""
    engine = AvatarsyncEngine(aligner_paths)
    try:
        first, second = engine.lease(), engine.lease()
        await first.start()
        native = engine._engine  # noqa: SLF001
        await second.start()

        pcm, text, ms = load_clip("take-your-time")
        assert await first.text_cues(text, ms)
        # The second session goes through the decoder, not just the text leg —
        # the shared thing being tested is the acoustic model, and only a stream
        # touches it.
        stream = await second.open_stream(24000)
        assert stream is not None
        try:
            await stream.feed(pcm)
            assert await stream.finish()
        finally:
            await stream.close()
        # Nothing reloaded: `start()` is idempotent, and the second session
        # found the model already there.
        assert engine._engine is native  # noqa: SLF001
    finally:
        await engine.stop()


async def test_a_session_closing_does_not_unload_the_model(
    aligner_paths: AvatarsyncPaths,
) -> None:
    """`VisemeEngine.aclose()` stops whatever runtime it was given. That is right
    when it owns the model and catastrophic when it shares one, so a lease
    releases itself and leaves the engine loaded — and then refuses to be used,
    rather than quietly borrowing it again."""
    engine = AvatarsyncEngine(aligner_paths)
    try:
        lease = engine.lease()
        await lease.start()
        await lease.stop()

        # Still *loaded*, not merely still usable: a reload would also satisfy
        # the next-session assertion below while costing 250 ms per session,
        # which is the whole thing a shared engine exists to avoid.
        assert engine._engine is not None, "releasing a lease unloaded the shared model"
        with pytest.raises(AvatarsyncError, match="lease is closed"):
            await lease.text_cues("Take your time.", 830)
        # The next session is unaffected.
        assert await engine.lease().text_cues("Take your time.", 830)
    finally:
        await engine.stop()


async def test_the_decode_bound_is_the_memory_bound(aligner: AvatarsyncEngine) -> None:
    """Concurrency is capped on purpose. Each concurrent decode makes Rhubarb's
    `ObjectPool` allocate another ~58 MB decoder, so an unbounded executor —
    `asyncio.to_thread`'s default is up to 32 threads — would answer a burst of
    sentences by allocating 1.8 GB of acoustic model."""
    executor = aligner._executor  # noqa: SLF001
    assert executor is not None
    assert executor._max_workers == DEFAULT_WORKERS  # noqa: SLF001


async def test_shared_engine_is_one_engine_per_worker(aligner_paths: AvatarsyncPaths) -> None:
    try:
        assert shared_engine(aligner_paths) is shared_engine(aligner_paths)
    finally:
        await stop_shared_engine()
    assert shared_engine(aligner_paths) is not None
    await stop_shared_engine()
