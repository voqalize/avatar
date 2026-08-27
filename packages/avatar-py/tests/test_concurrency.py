"""One process, one event loop, many coroutines through the aligner.

The property being asserted here is the one the old subprocess pipeline could
only claim: that lipsync is a **library call in this process**. No fork, no
spawn, no helper daemon, no per-call warm-up — a `ctypes` call into a resident
shared library, dispatched to a bounded thread pool, from as many concurrent
sessions as the process is carrying calls.

That makes three separate things worth testing, and only the first is about
speed:

1. **Nothing is spawned.** Not incidentally, not on the first call, not under
   load. `test_nothing_ever_spawns_a_child_process` is the load-bearing one — a
   regression there is a deployment problem (zombie reaping, container PID
   limits, signal handling), not a performance one.
2. **Interleaving changes nothing.** The C++ hands out a decoder per concurrent
   caller from a pool, and the pool is the place a cross-wire would live: two
   sessions sharing a decoder mid-decode would return each other's phones. So
   every assertion here is against a **serial baseline of the same work**.

   Equality is the wrong instrument for half of that, and finding out why is
   worth the paragraph. The fast leg *is* exactly reproducible and is asserted
   that way. The accurate leg is not: upstream passes `-dither yes` to
   PocketSphinx (`PhoneticRecognizer.cpp`, "add noise against zero silence"), and
   that dither runs off a front-end RNG whose state advances with every frame
   decoded. So a decoder's output depends on what it decoded before it — the same
   PCM through one decoder, serially, twice, differs; measured here at up to 21%
   of frames on the longest fixture. Concurrency changes *which* decoder serves
   you, and therefore changes the answer, without anything being wrong.

   The invariant that survives is the useful one anyway: **concurrent decodes
   must be no less faithful than serial repeats of the same work**, with the
   serial floor measured in the same run rather than written down as a constant,
   and every result must still be recognisably its own audio rather than its
   neighbour's. Cross-clip agreement is ~0.16 against ~0.96 same-clip, so a genuine
   cross-wire is not a marginal call.
3. **The loop keeps moving.** A voice agent's event loop carries audio frames at
   20 ms. `ctypes` releases the GIL for the duration of a foreign call, which is
   what makes a 21 ms decode cost the loop nothing; if that stopped being true,
   the symptom in production is choppy audio, not slow visemes.

`test_avatarsync.py` already covers the single-decode versions of (3) — one
decode not blocking the loop, two decodes overlapping. This file is about what
happens with a *burst*, and about the production path: several `VisemeEngine`
sessions leasing one shared engine, which is what a worker running N calls
actually looks like.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import threading
import time
from collections.abc import Sequence

import pytest

from voqalize_avatar.avatarsync import (
    DEFAULT_WORKERS,
    AvatarsyncEngine,
    AvatarsyncPaths,
    Cue,
    shared_engine,
)
from voqalize_avatar.visemes import SAMPLE_RATE, VisemeEngine

from .conftest import CLIPS, load_clip

# Every clip we have, so an interleaved run is decoding genuinely different
# audio in parallel rather than the same buffer N times — identical inputs would
# hide a decoder that returns the *previous* caller's result.
CLIP_NAMES = sorted(CLIPS)


def _clips() -> list[tuple[bytes, str, int]]:
    return [load_clip(name) for name in CLIP_NAMES]


def _letter_at(cues: Sequence[Cue], t_ms: int) -> str:
    """The shape on screen at `t_ms` — a cue is held until the next one."""
    letter = "X"
    for cue in cues:
        if cue.t > t_ms:
            break
        letter = cue.v
    return letter


def agreement(a: Sequence[Cue], b: Sequence[Cue], ms: int) -> float:
    """Fraction of 10 ms frames where two tracks put the same shape on the face.

    The comparison that matches what a viewer sees. Two tracks that differ by a
    phone label, or by a boundary moving 20 ms, are the same animation; a diff
    over cue lists calls them different and would make every assertion below a
    coin toss (see the dither note in the module docstring).
    """
    frames = max(1, ms // 10)
    same = sum(_letter_at(a, i * 10) == _letter_at(b, i * 10) for i in range(frames))
    return same / frames


# ---------------------------------------------------------------------------
# 1. Nothing is spawned
# ---------------------------------------------------------------------------


async def test_nothing_ever_spawns_a_child_process(
    aligner: AvatarsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point of the ABI rewrite, asserted rather than assumed.

    Two independent checks, because they fail differently. The monkeypatches
    catch a spawn *attempt* at the moment it happens and name the call; the
    `waitpid` check catches one that happened anyway — through a path we did not
    think to patch, or from inside the C++ — by asking the kernel whether this
    process has any children at all.

    `os.waitpid(-1, WNOHANG)` raises `ChildProcessError` only when there are
    **no** children; a live child that simply has not exited returns `(0, 0)`.
    So this asserts on the exception, not on the pid.
    """
    calls: list[str] = []

    def forbid(name: str):
        def guard(*args: object, **kwargs: object):
            calls.append(name)
            raise AssertionError(f"lipsync spawned a child process via {name}")

        return guard

    # posix_spawn is the one that matters on macOS (subprocess prefers it), fork
    # the one that matters on Linux, and Popen catches both plus anything that
    # goes through the stdlib's higher level.
    monkeypatch.setattr(subprocess, "Popen", forbid("subprocess.Popen"))
    monkeypatch.setattr(os, "fork", forbid("os.fork"), raising=False)
    monkeypatch.setattr(os, "posix_spawn", forbid("os.posix_spawn"), raising=False)
    monkeypatch.setattr(os, "spawnv", forbid("os.spawnv"), raising=False)

    clips = _clips()
    # A burst, not one call: a lazy `Popen` on the *first* decode would slip
    # through a single-call test, and so would one on pool growth.
    await asyncio.gather(
        *(aligner.audio_cues(pcm, SAMPLE_RATE) for pcm, _, _ in clips * 4),
        *(aligner.text_cues(text, ms) for _, text, ms in clips * 4),
    )

    assert not calls
    with pytest.raises(ChildProcessError):
        os.waitpid(-1, os.WNOHANG)


# ---------------------------------------------------------------------------
# 2. Interleaving changes nothing
# ---------------------------------------------------------------------------


async def test_the_fast_leg_is_exactly_reproducible_under_concurrency(
    aligner: AvatarsyncEngine,
) -> None:
    """Byte-for-byte equality, where it is honestly available.

    The fast leg is a dictionary lookup and an arithmetic layout — no decoder, no
    dither, no shared mutable state — so it is a pure function of `(text,
    duration)` and nothing about running 24 of them at once may change that. It
    also runs *on the event loop* while decodes occupy the pool, which is the
    interleaving that matters: this is the one place both legs contend.
    """
    clips = _clips()
    baseline = {
        name: await aligner.text_cues(text, ms)
        for name, (_, text, ms) in zip(CLIP_NAMES, clips, strict=True)
    }

    for _round in range(4):
        jobs, order = [], []
        for k in range(8):
            name = CLIP_NAMES[k % len(CLIP_NAMES)]
            pcm, text, ms = clips[k % len(clips)]
            jobs.append(aligner.text_cues(text, ms))
            order.append(name)
            # Queued alongside on purpose; its result is checked elsewhere.
            jobs.append(aligner.audio_cues(pcm, SAMPLE_RATE))
            order.append("")

        results = await asyncio.gather(*jobs)

        for name, cues in zip(order, results, strict=True):
            if name:
                assert cues == baseline[name], f"the fast leg for {name} moved under load"


async def test_interleaved_decodes_stay_with_their_own_audio(
    aligner: AvatarsyncEngine,
) -> None:
    """The cross-wire test, with the serial floor measured rather than assumed.

    Three claims, in order of what a failure would mean:

    * every concurrent result resembles **its own** clip more than any other
      clip — a decoder handed to two callers at once fails here, decisively,
      because same-clip agreement is ~0.96 and cross-clip ~0.16;
    * concurrent decodes are no less faithful than serial repeats of the same
      work, which is what "concurrency costs nothing" means once the leg is
      known not to be deterministic;
    * the fidelity floor is not silently terrible — a run where *everything*
      degraded equally would satisfy the comparison above.

    Several rounds, because a pool hand-out race is a race: one round that
    happens to serialise proves nothing.
    """
    clips = dict(zip(CLIP_NAMES, _clips(), strict=True))
    baseline = {name: await aligner.audio_cues(pcm, SAMPLE_RATE) for name, (pcm, _, _) in clips.items()}

    # Same work, same *number of samples*, no concurrency: the control. The equal
    # count is load-bearing and was learned the hard way — 9 serial samples against
    # 36 concurrent ones made the concurrent minimum reach four times as far into
    # the same wobble distribution, and the comparison read as a 12-point
    # concurrency penalty that did not exist. Measured at equal n, both legs bottom
    # out at the same 0.798 on the same fixture.
    rounds = 4
    order = [CLIP_NAMES[k % len(CLIP_NAMES)] for k in range(9)]

    serial: list[float] = []
    for _round in range(rounds):
        for name in order:
            pcm, _, ms = clips[name]
            again = await aligner.audio_cues(pcm, SAMPLE_RATE)
            serial.append(agreement(again, baseline[name], ms))

    concurrent: list[float] = []
    for _round in range(rounds):
        results = await asyncio.gather(
            *(aligner.audio_cues(clips[name][0], SAMPLE_RATE) for name in order)
        )
        for name, cues in zip(order, results, strict=True):
            ms = clips[name][2]
            concurrent.append(agreement(cues, baseline[name], ms))
            nearest = max(
                CLIP_NAMES,
                key=lambda other: agreement(cues, baseline[other], min(ms, clips[other][2])),
            )
            assert nearest == name, f"a decode of {name} came back looking like {nearest}"

    # The mean is the honest statistic once the sample sizes match — the minimum is
    # a single draw from a discrete wobble (agreement only ever takes a handful of
    # values here) and pins itself to the worst of them in every run, serial and
    # concurrent alike. The slack is measured, not chosen: six batches of 36 put
    # the serial mean in 0.922–0.954 and the concurrent mean in 0.925–0.953, with
    # concurrency ahead in half of them, so 0.05 is this statistic's own noise
    # band. A genuine cross-wire does not cost 5 points — it costs 80, and the
    # identification check above would have caught it first.
    assert sum(concurrent) / len(concurrent) >= sum(serial) / len(serial) - 0.05, (
        f"concurrent decodes averaged {sum(concurrent) / len(concurrent):.3f} against their "
        f"serial baseline, worse than serial repeats managed on their own "
        f"({sum(serial) / len(serial):.3f})"
    )
    # The floor is the dither bound the test below pins down, not a second
    # tolerance: no concurrent decode may be worse than the same decode repeated.
    assert min(concurrent) >= 0.75


async def test_repeated_decodes_wobble_but_stay_within_a_bound(
    aligner: AvatarsyncEngine,
) -> None:
    """The dither wobble, bounded — because every tolerance here rests on it.

    Serial, one clip, one decoder, no concurrency of any kind: the same PCM
    decoded six times is *not* guaranteed to produce the same cues, for the
    reason in the module docstring. What must hold is that the variation is
    cosmetic — a boundary sliding, a phone relabelled inside a held shape — and
    never a different animation. If this floor ever drops, the tolerances in the
    concurrency tests above stop meaning what they say, and the failure belongs
    here rather than looking like a concurrency bug three tests away.
    """
    for name, (pcm, _text, ms) in zip(CLIP_NAMES, _clips(), strict=True):
        first = await aligner.audio_cues(pcm, SAMPLE_RATE)
        for _ in range(5):
            again = await aligner.audio_cues(pcm, SAMPLE_RATE)
            score = agreement(again, first, ms)
            assert score >= 0.75, f"{name} decoded to a different animation ({score:.3f})"


async def test_the_pool_is_the_bound_on_threads(aligner: AvatarsyncEngine) -> None:
    """32 concurrent decodes are still `DEFAULT_WORKERS` threads.

    The memory figure is per *decoder*, ~58 MB, and a decoder is built per
    concurrent caller — so an unbounded pool is not a tidiness problem, it is a
    worker that dies under a burst of calls.
    """
    clips = _clips()
    before = {t for t in threading.enumerate() if t.name.startswith("avatarsync")}

    async def peak() -> int:
        # Sampled while the burst is in flight; afterwards is too late, since a
        # pool that grew and shrank would look innocent.
        seen = 0
        for _ in range(40):
            live = len([t for t in threading.enumerate() if t.name.startswith("avatarsync")])
            seen = max(seen, live)
            await asyncio.sleep(0.005)
        return seen

    watcher = asyncio.ensure_future(peak())
    await asyncio.gather(
        *(aligner.audio_cues(pcm, SAMPLE_RATE) for pcm, _, _ in clips * 11),
    )
    high_water = await watcher

    assert len(before) <= DEFAULT_WORKERS
    assert high_water <= DEFAULT_WORKERS, (
        f"{high_water} avatarsync threads under load, pool is {DEFAULT_WORKERS}"
    )


# ---------------------------------------------------------------------------
# 3. The loop keeps moving
# ---------------------------------------------------------------------------


async def test_a_burst_of_decodes_never_stalls_the_loop(
    aligner: AvatarsyncEngine,
) -> None:
    """Worst case for the loop: more queued decodes than there are workers.

    Measured as the **worst** gap between heartbeats, not the count of them: an
    average stays comfortable while one 200 ms freeze drops ten frames of audio,
    and the freeze is the thing a caller would hear.
    """
    clips = _clips()
    gaps: list[float] = []
    stop = False

    async def heartbeat() -> None:
        last = time.perf_counter()
        while not stop:
            await asyncio.sleep(0.002)
            now = time.perf_counter()
            gaps.append(now - last)
            last = now

    beat = asyncio.ensure_future(heartbeat())
    await asyncio.gather(*(aligner.audio_cues(pcm, SAMPLE_RATE) for pcm, _, _ in clips * 8))
    stop = True
    await beat

    worst = max(gaps)
    # One 20 ms audio frame is the budget that matters; 50 ms leaves room for a
    # loaded CI runner without leaving room for a blocked loop. A decode that
    # held the GIL would park the loop for its full ~21 ms every time, and with
    # 24 of them queued this would be seconds, not milliseconds.
    assert worst < 0.05, f"the loop stalled for {worst * 1000:.0f} ms during 24 decodes"


# ---------------------------------------------------------------------------
# The production path: many sessions, one engine
# ---------------------------------------------------------------------------


def _script(ctx: str) -> list[tuple[str, tuple[bytes, str, int]]]:
    """One session's turn: every clip queued, then spoken, in order."""
    return [(ctx, clip) for clip in _clips()]


# What vql-speech sends. The frame size is a non-variable for the decode — the
# resampler has no filter tail, so an incrementally fed stream is bit-identical
# to a batch one — but it is the cadence the loop is actually asked to survive.
FRAME_BYTES = 200 * SAMPLE_RATE // 1000 * 2


async def _run_session(engine: VisemeEngine, ctx: str) -> None:
    """Drive one session exactly as `AvatarProcessor` does.

    Queue every sentence (fast leg), feed the audio frame by frame into the live
    decode, mark each sentence spoken as its samples run out, and close the
    context. `flush` is the only thing here a live pipeline would not call — it
    waits for the per-turn worker to drain, which a `process_frame` must never do
    and a test otherwise has to guess at with a sleep.
    """
    for _, (_pcm, text, _ms) in _script(ctx):
        await engine.on_sentence_queued(ctx, text)
    for _, (pcm, _text, _ms) in _script(ctx):
        for at in range(0, len(pcm), FRAME_BYTES):
            await engine.on_audio(ctx, pcm[at : at + FRAME_BYTES], sample_rate=SAMPLE_RATE)
        await engine.on_sentence_spoken(ctx)
    await engine.on_context_closed(ctx)
    await engine.flush(ctx)
    # The decoder goes back to the pool here. Without it the next `_emissions`
    # run would find the pool empty and every session would latch to predicted
    # cues — which is a legitimate degradation and a useless comparison.
    await engine.end_turn(ctx)


async def _emissions(
    paths: AvatarsyncPaths, contexts: list[str], *, concurrent: bool
) -> dict[str, list[tuple[int, tuple[Cue, ...], bool]]]:
    """Run N sessions against one shared engine; return each one's wire stream.

    A session per context, each with its own `VisemeEngine` and its own lease —
    which is what a worker carrying N calls has — but one loaded model behind
    all of them.
    """
    out: dict[str, list[tuple[int, tuple[Cue, ...], bool]]] = {c: [] for c in contexts}

    def collector(ctx: str):
        async def emit(
            emitted_ctx: str, from_ms: int, cues: list[Cue], final: bool
        ) -> None:
            # Asserted here rather than after the fact: a session emitting under
            # another session's ctx is the failure this whole file is about, and
            # the traceback is worth more than a diff at the end.
            assert emitted_ctx == ctx, f"session {ctx} emitted under ctx {emitted_ctx}"
            out[ctx].append((from_ms, tuple(cues), final))

        return emit

    engines = {
        ctx: VisemeEngine(collector(ctx), shared_engine(paths).lease(), sample_rate=SAMPLE_RATE)
        for ctx in contexts
    }
    try:
        if concurrent:
            await asyncio.gather(*(_run_session(engines[c], c) for c in contexts))
        else:
            for ctx in contexts:
                await _run_session(engines[ctx], ctx)
    finally:
        for engine in engines.values():
            await engine.aclose()
    return out


async def test_concurrent_sessions_emit_what_one_session_at_a_time_did(
    aligner_paths: AvatarsyncPaths,
) -> None:
    """Six calls in one worker, interleaved, versus six calls run one after another.

    This is the assertion the library exists to support. Everything above tests
    the aligner; this tests the thing a consumer actually holds — several
    `VisemeEngine`s, each with its own turn state and its own per-turn worker
    task, all leasing one 86 MB model on one event loop.

    Split by what each part is made of. The **bookkeeping** — how many emissions,
    their `from_ms` splice points, which one carries `final` — is ours: per-turn
    state, byte-derived offsets, a queue drained by one worker task. Nothing
    about it is allowed to move, so it is compared with equality. A session
    reading another's `resolved_wire_ms` shows up there as a shifted splice point
    rather than as anything the shapes alone would reveal. The **cues** come out
    of the decoder and carry its dither wobble, so they are compared as
    animations.

    Two sessions, not the pool's four-decoder ceiling: `DEFAULT_WORKERS` is 1,
    so the executor thread — not the decoder pool — is what "concurrent" means
    here. Push more sessions through one thread than it can actually keep off
    the realtime floor and every one of them trips `ACCURATE_CUE_LATCH_RTF`
    (`visemes.py`) and permanently falls back to predicted cues — a real and
    correct behaviour, but a different property than the one this test checks,
    and it would swamp the splice comparison below with latch fallbacks rather
    than genuine interleaving. Two sessions is enough to prove the splicing
    survives real overlap without asking one worker thread for four-way
    parallelism it was never sized to give.
    """
    contexts = [f"s{i}" for i in range(2)]

    serial = await _emissions(aligner_paths, contexts, concurrent=False)
    interleaved = await _emissions(aligner_paths, contexts, concurrent=True)

    for ctx in contexts:
        mine, baseline = interleaved[ctx], serial[ctx]
        # Splice *points* are allowed to drift, splice *count and order* are
        # not: with DEFAULT_WORKERS=1, four "concurrent" sessions actually
        # queue onto one executor thread, so a decode that overlapped another
        # session's under real parallelism now waits behind it — the accurate
        # leg arrives later in wall-clock time and the predicted-cue window it
        # closes moves with it. That is the single worker doing its job, not a
        # cross-wire; a cross-wire changes *which* cues arrive, which the
        # agreement score below still catches. SPLICE_TOLERANCE_MS is
        # generous because CI's shared runner is slower and noisier than a
        # laptop, and this test compares against a same-run serial baseline
        # rather than a fixed constant precisely so it isn't tuned to one
        # machine.
        SPLICE_TOLERANCE_MS = 300
        assert len(mine) == len(baseline), (
            f"session {ctx} emitted {len(mine)} splices under load, {len(baseline)} serially"
        )
        for (t, _, final), (baseline_t, _, baseline_final) in zip(mine, baseline, strict=True):
            assert final == baseline_final, f"session {ctx} spliced differently under load"
            assert abs(t - baseline_t) <= SPLICE_TOLERANCE_MS, (
                f"session {ctx} spliced at {t} ms under load vs {baseline_t} ms serially "
                f"(tolerance {SPLICE_TOLERANCE_MS} ms)"
            )

        for (start, cues, _), (_, expected, _) in zip(mine, baseline, strict=True):
            span = max(
                (c.t for c in (*cues, *expected)),
                default=start,
            ) - start
            score = agreement(cues, expected, max(10, span))
            assert score >= 0.75, (
                f"session {ctx} emitted a different animation at {start} ms ({score:.3f})"
            )

    # Not a tautology: a session that emitted nothing would satisfy the
    # comparisons above if the baseline was also broken.
    assert all(len(stream) > len(CLIP_NAMES) for stream in interleaved.values())
    # The turn's closing X, and only ever the last thing a session says.
    for stream in interleaved.values():
        assert [final for _, _, final in stream].count(True) == 1
        assert stream[-1][2] is True


async def test_sessions_do_not_spawn_a_process_either(
    aligner_paths: AvatarsyncPaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The no-spawn guarantee, at the layer a consumer imports.

    Separate from the engine-level test because the path is different: this one
    goes through `shared_engine`, a lease per session, `prewarm`, and the per-turn
    worker tasks — any of which could have been where a helper process got
    started.
    """

    def guard(*args: object, **kwargs: object):
        raise AssertionError("a session spawned a child process")

    monkeypatch.setattr(subprocess, "Popen", guard)
    monkeypatch.setattr(os, "fork", guard, raising=False)
    monkeypatch.setattr(os, "posix_spawn", guard, raising=False)

    await _emissions(aligner_paths, ["a", "b", "c"], concurrent=True)

    with pytest.raises(ChildProcessError):
        os.waitpid(-1, os.WNOHANG)
