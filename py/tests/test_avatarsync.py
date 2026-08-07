"""The resident process: round trips, concurrency, and the two ways it dies.

Against the real binary. A fake subprocess would pass all of this while telling
us nothing about the properties that actually matter — that the process survives
requests, that id correlation holds when several callers await at once, and that
a death is recoverable rather than terminal.
"""

from __future__ import annotations

import asyncio
import os
import signal
import time

import pytest

from voqalize_avatar.avatarsync import (
    VISEME_LETTERS,
    Cue,
    RhubarbError,
    RhubarbPaths,
    RhubarbPool,
    RhubarbRuntime,
    platform_id,
    shared_pool,
    shift,
    stop_shared_pool,
)

from .conftest import load_clip


def test_platform_id_normalises_arch() -> None:
    # The one string that must agree across three places: this module,
    # native/avatarsync/build.sh, and the committed bin/<platform>/ directory.
    assert platform_id() in {"darwin-arm64", "linux-x64", "darwin-x64", "linux-arm64"}


async def test_ready_line_reports_a_loaded_model(rhubarb: RhubarbRuntime) -> None:
    info = rhubarb.ready_info
    assert info["ready"] is True
    # A dictionary this size is the whole cmudict; anything much smaller means
    # the res tree was half-materialised.
    assert int(info["dict_entries"]) > 100_000  # type: ignore[arg-type]
    # warmup_ms near zero would mean the acoustic model never loaded and the
    # first real audio request pays ~180 ms instead of ~20. That is exactly the
    # regression the resident process exists to prevent, so assert on it.
    assert float(info["warmup_ms"]) > 10  # type: ignore[arg-type]
    assert await rhubarb.ping() is True


async def test_text_leg_round_trip(rhubarb: RhubarbRuntime) -> None:
    cues = await rhubarb.text_cues("Take your time.", 830)

    assert cues, "the text leg produced no cues"
    assert all(cue.v in VISEME_LETTERS for cue in cues)
    assert [cue.t for cue in cues] == sorted(cue.t for cue in cues)
    assert cues[0].t == 0
    assert cues[-1].t <= 830


async def test_audio_leg_round_trip(rhubarb: RhubarbRuntime) -> None:
    pcm, _, ms = load_clip("that-is-good-to-hear")

    cues = await rhubarb.audio_cues(pcm)

    assert cues
    assert all(cue.v in VISEME_LETTERS for cue in cues)
    assert cues[-1].t <= ms


async def test_process_outlives_requests(rhubarb: RhubarbRuntime) -> None:
    pid = rhubarb.pid
    for _ in range(5):
        await rhubarb.text_cues("One moment.", 600)
    assert rhubarb.pid == pid
    assert rhubarb.restarts == 0


async def test_concurrent_requests_do_not_cross_wires(rhubarb: RhubarbRuntime) -> None:
    # Durations far enough apart that a mis-correlated response is unmistakable:
    # a 400 ms track cannot be confused with a 3200 ms one.
    durations = [400, 800, 1200, 1600, 2000, 2400, 2800, 3200]

    results = await asyncio.gather(
        *(rhubarb.text_cues("Thanks for sharing that with me.", ms) for ms in durations)
    )

    for ms, cues in zip(durations, results, strict=True):
        assert cues, f"no cues for {ms}ms"
        assert cues[-1].t <= ms
        # The last cue lands in the back half of the clip — enough to pin the
        # response to its own duration and not a neighbour's.
        assert cues[-1].t > ms * 0.4


async def test_empty_input_never_reaches_the_process(rhubarb: RhubarbRuntime) -> None:
    assert await rhubarb.text_cues("Hello.", 0) == []
    assert await rhubarb.audio_cues(b"") == []


async def test_crash_fails_in_flight_then_the_next_request_restarts(
    rhubarb_paths: RhubarbPaths,
) -> None:
    runtime = RhubarbRuntime(rhubarb_paths)
    try:
        await runtime.start()
        pid = runtime.pid
        assert pid is not None

        # A long clip so the kill lands while the request is genuinely in
        # flight: ~9 s of audio is ~150 ms of recognition.
        pcm, _, _ = load_clip("thank-you-for-your-time-today")
        request = asyncio.create_task(runtime.audio_cues(pcm * 6))
        await asyncio.sleep(0.02)
        os.kill(pid, signal.SIGKILL)

        with pytest.raises(RhubarbError):
            await request

        # The call must keep going: the next request respawns.
        cues = await runtime.text_cues("Sorry, go on.", 700)
        assert cues
        assert runtime.restarts == 1
        assert runtime.pid not in (None, pid)
    finally:
        await runtime.stop()


async def test_timeout_restarts_rather_than_wedging_the_queue(
    rhubarb_paths: RhubarbPaths,
) -> None:
    # The binary serves one request at a time, so a request that outlives its
    # timeout would keep answering into a queue nobody is waiting on and stall
    # everything behind it. The runtime tears the process down instead.
    runtime = RhubarbRuntime(rhubarb_paths, request_timeout_s=0.001)
    try:
        await runtime.start()
        pcm, _, _ = load_clip("thank-you-for-your-time-today")

        with pytest.raises(RhubarbError, match="timed out"):
            await runtime.audio_cues(pcm)

        assert not runtime.running

        runtime.request_timeout_s = 5.0
        cues = await runtime.text_cues("One moment.", 600)
        assert cues
        assert runtime.restarts == 1
    finally:
        await runtime.stop()


async def test_stop_is_final(rhubarb_paths: RhubarbPaths) -> None:
    runtime = RhubarbRuntime(rhubarb_paths)
    await runtime.start()
    await runtime.stop()

    with pytest.raises(RhubarbError, match="closed"):
        await runtime.text_cues("Anything.", 500)


@pytest.mark.parametrize("leg", ["text", "audio"])
async def test_warm_latency(rhubarb: RhubarbRuntime, leg: str) -> None:
    """Both legs must stay far under a 20 ms audio frame's worth of budget.

    Measured on darwin-arm64 (M-series), median over 10 runs:
        text leg   0.4-0.8 ms
        audio leg  15-16 ms for an 830 ms clip

    The bounds below are ~4x those, loose enough to survive a busy CI box and
    tight enough to catch the regression that matters: a lost warm decoder pool
    puts the audio leg back at ~180 ms.
    """
    pcm, text, ms = load_clip("take-your-time")
    budget_ms = 5.0 if leg == "text" else 60.0

    async def once() -> None:
        if leg == "text":
            await rhubarb.text_cues(text, ms)
        else:
            await rhubarb.audio_cues(pcm)

    await once()  # discard the first: it is the pipe warming, not the leg
    samples: list[float] = []
    for _ in range(10):
        started = time.perf_counter()
        await once()
        samples.append((time.perf_counter() - started) * 1000)

    samples.sort()
    median = samples[len(samples) // 2]
    assert median < budget_ms, f"{leg} leg median {median:.1f}ms exceeds {budget_ms}ms"


def test_shift_moves_a_track_onto_the_turn_timeline() -> None:
    assert shift([Cue(t=0, v="A"), Cue(t=100, v="B")], 250) == [
        Cue(t=250, v="A"),
        Cue(t=350, v="B"),
    ]


# ── the shared pool ──────────────────────────────────────────────────────────


async def test_the_pool_shares_processes_across_sessions(rhubarb_paths: RhubarbPaths) -> None:
    """Two sessions, one set of processes. This is the whole reason the pool
    exists: the 86 MB acoustic model is per *decoder*, so per-session processes
    made memory scale with concurrency for no throughput at all."""
    pool = RhubarbPool(rhubarb_paths, size=2)
    try:
        first, second = pool.lease(), pool.lease()
        await first.start()
        await second.start()
        pids = {runtime.pid for runtime in pool.runtimes}
        assert len(pids) == 2 and None not in pids

        pcm, text, ms = load_clip("take-your-time")
        assert await first.text_cues(text, ms)
        assert await second.audio_cues(pcm)
        # Nothing respawned: `start()` is idempotent, and the second session
        # found the model already loaded.
        assert {runtime.pid for runtime in pool.runtimes} == pids
    finally:
        await pool.stop()


async def test_a_session_closing_does_not_take_the_pool_with_it(
    rhubarb_paths: RhubarbPaths,
) -> None:
    """`VisemeEngine.aclose()` stops whatever runtime it was given. That is right
    when it owns a process and catastrophic when it shares one, so a lease
    releases itself and leaves the processes running — and then refuses to be
    used, rather than quietly borrowing the pool again."""
    pool = RhubarbPool(rhubarb_paths, size=1)
    try:
        lease = pool.lease()
        await lease.start()
        pid = pool.runtimes[0].pid
        await lease.stop()

        assert pool.runtimes[0].pid == pid
        assert pool.runtimes[0].running
        with pytest.raises(RhubarbError):
            await lease.text_cues("Take your time.", 830)
        # The next session is unaffected.
        assert await pool.lease().text_cues("Take your time.", 830)
    finally:
        await pool.stop()


async def test_dispatch_goes_to_the_idlest_process(rhubarb_paths: RhubarbPaths) -> None:
    """Least-inflight, not round-robin. The legs differ by two orders of
    magnitude in cost, and the cheap one is the one with a deadline: a rotation
    would routinely park a 0.4 ms fast leg behind a 25 ms audio leg."""
    pool = RhubarbPool(rhubarb_paths, size=2)
    try:
        await pool.start()
        pcm, text, ms = load_clip("thank-you-for-your-time-today")
        # Enough audio legs in flight to fill both pipes several times over.
        results = await asyncio.gather(
            *(pool.audio_cues(pcm) for _ in range(6)),
            *(pool.text_cues(text, ms) for _ in range(6)),
        )
        assert all(results)
        assert all(cue.v in VISEME_LETTERS for track in results for cue in track)
        # Both processes did work — a single busy pipe would have served all 12.
        assert all(runtime.restarts == 0 for runtime in pool.runtimes)
    finally:
        await pool.stop()


async def test_shared_pool_is_one_pool_per_worker(rhubarb_paths: RhubarbPaths) -> None:
    try:
        assert shared_pool(rhubarb_paths) is shared_pool(rhubarb_paths)
    finally:
        await stop_shared_pool()
    assert shared_pool(rhubarb_paths) is not None
    await stop_shared_pool()
