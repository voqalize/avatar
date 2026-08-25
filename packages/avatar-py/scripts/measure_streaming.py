"""Measure the streaming viseme path against the five constraints it was built for.

    cd py && uv run python scripts/measure_streaming.py

Runs the real `VisemeEngine` over the test fixtures, through the same entry
points `AvatarProcessor` calls, at the frame cadences pipecat actually delivers.
Nothing here is asserted — the suite does that. This exists because the numbers
that decided the design are only worth having if they can be taken again after a
change:

1. lips move with audio      — when the first cue track lands, and what it covers
2. accurate catches up       — audio fed before the first correction, and the
                               accurate edge's lag behind the fed edge
3. asyncio                   — worst event-loop stall during a live session
4. bounded CPU / memory      — decode RTF, pool ceiling, RSS per live stream
5. pipecat frames            — 200 ms (vql-speech) vs 500 ms (Google) cadence
"""

from __future__ import annotations

import asyncio
import resource
import statistics
import sys
import time

sys.path.insert(0, ".")
sys.path.insert(0, "src")

from voqalize_avatar.avatarsync import AvatarsyncEngine, AvatarsyncPaths, Cue, shared_engine
from voqalize_avatar.timing import ACCURATE_CUE_HOLD_BACK_MS
from voqalize_avatar.visemes import SAMPLE_RATE, VisemeEngine

from tests.conftest import CLIPS, load_clip as _load_clip

CLIP_NAMES = sorted(CLIPS)

# Production shape: the streaming wire puts 250 ms of silence between sentences,
# and the fixtures are pure speech with that pad stripped. Measuring on the bare
# fixture tests the fast leg's 280 ms trail hedge outside its operating point —
# it reserves real speech as silence and the mouth dies a quarter second early.
PAD_MS = 250


def load_clip(name):
    pcm, text, ms = _load_clip(name)
    return pcm + b"\x00" * (PAD_MS * SAMPLE_RATE // 1000 * 2), text, ms + PAD_MS


def rss_mb() -> float:
    kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return kb / (1024 * 1024) if sys.platform == "darwin" else kb / 1024


def letter_at(cues, t_ms: int) -> str:
    letter = "X"
    for cue in cues:
        if cue.t > t_ms:
            break
        letter = cue.v
    return letter


def agreement(a, b, ms: int) -> float:
    frames = max(1, ms // 10)
    return sum(letter_at(a, i * 10) == letter_at(b, i * 10) for i in range(frames)) / frames


class Recorder:
    """Every emission, stamped with when it happened relative to the first frame."""

    def __init__(self) -> None:
        self.calls: list[tuple[float, int, list[Cue], bool]] = []
        self.t0 = 0.0

    async def __call__(self, ctx: str, from_ms: int, cues: list[Cue], final: bool) -> None:
        self.calls.append(((time.perf_counter() - self.t0) * 1000, from_ms, list(cues), final))

    def track(self) -> list[Cue]:
        """Replay the emissions into the single track the client ends up holding."""
        out: list[Cue] = []
        for _, from_ms, cues, _ in self.calls:
            out = [c for c in out if c.t < from_ms] + list(cues)
        return out


async def run_session(
    paths: AvatarsyncPaths, name: str, chunk_ms: int
) -> tuple[Recorder, dict[str, float]]:
    pcm, text, ms = load_clip(name)
    rec = Recorder()
    engine = VisemeEngine(rec, shared_engine(paths).lease(), sample_rate=SAMPLE_RATE)

    frame = chunk_ms * SAMPLE_RATE // 1000 * 2
    gaps: list[float] = []
    stop = False

    async def heartbeat() -> None:
        last = time.perf_counter()
        while not stop:
            await asyncio.sleep(0.002)
            now = time.perf_counter()
            gaps.append((now - last) * 1000)
            last = now

    beat = asyncio.ensure_future(heartbeat())
    await engine.on_sentence_queued("c", text)

    rec.t0 = time.perf_counter()
    began = time.perf_counter()
    for at in range(0, len(pcm), frame):
        await engine.on_audio("c", pcm[at : at + frame], sample_rate=SAMPLE_RATE)
    await engine.on_sentence_spoken("c")
    await engine.on_context_closed("c")
    await engine.flush("c")
    wall = (time.perf_counter() - began) * 1000
    stop = True
    await beat
    await engine.end_turn("c")
    await engine.aclose()

    return rec, {"speech_ms": ms, "wall_ms": wall, "worst_gap_ms": max(gaps)}


async def main() -> None:
    paths = AvatarsyncPaths.discover()
    warm = AvatarsyncEngine(paths)
    await warm.start()
    baseline = {n: await warm.audio_cues(load_clip(n)[0], SAMPLE_RATE) for n in CLIP_NAMES}
    predicted = {n: await warm.text_cues(load_clip(n)[1], load_clip(n)[2]) for n in CLIP_NAMES}
    await warm.stop()

    print(f"hold-back {ACCURATE_CUE_HOLD_BACK_MS} ms | rss after model load {rss_mb():.0f} MB\n")

    for chunk_ms in (200, 500):
        print(f"=== {chunk_ms} ms frames "
              f"({'vql-speech omnivoice' if chunk_ms == 200 else 'pipecat TTSService default'}) ===")
        for name in CLIP_NAMES:
            rec, stats = await run_session(paths, name, chunk_ms)
            ms = stats["speech_ms"]
            first_t, first_from, first_cues, _ = rec.calls[0]
            corrections = [c for c in rec.calls[1:] if not c[3]]

            # 1. lips move with audio
            covered = sum(
                1 for i in range(ms // 10) if letter_at(first_cues, i * 10) != "X"
            ) / max(1, ms // 10)

            # 2. accurate catches up
            first_fix = corrections[0][1] if corrections else None

            final = rec.track()
            vs_batch = agreement(final, baseline[name], ms)
            vs_pred = agreement(predicted[name], baseline[name], ms)

            print(f"  {name}  speech {ms} ms")
            print(f"    first cues at {first_t:6.1f} ms wall, from_ms={first_from}, "
                  f"{covered * 100:.0f}% of speech non-silent")
            print(f"    {len(rec.calls)} emissions, {len(corrections)} corrections; "
                  f"first correction splices at {first_fix} ms of audio"
                  if first_fix is not None else
                  f"    {len(rec.calls)} emissions, no accurate correction (latched)")
            print(f"    final track vs batch decode: {vs_batch * 100:.1f}%   "
                  f"(predicted-only would be {vs_pred * 100:.1f}%)")
            print(f"    decode wall {stats['wall_ms']:.0f} ms for {ms} ms audio "
                  f"= {stats['wall_ms'] / ms:.2f}x RTF; worst loop gap "
                  f"{stats['worst_gap_ms']:.1f} ms")
        print()

    # 4. pool ceiling and memory
    print("=== concurrent sessions (pool ceiling) ===")
    for n in (1, 2, 4, 6):
        before = rss_mb()
        recs = await asyncio.gather(
            *(run_session(paths, CLIP_NAMES[i % len(CLIP_NAMES)], 200) for i in range(n))
        )
        latched = sum(1 for rec, _ in recs if len([c for c in rec.calls if not c[3]]) <= 1)
        scores = [
            agreement(rec.track(), baseline[CLIP_NAMES[i % len(CLIP_NAMES)]],
                      load_clip(CLIP_NAMES[i % len(CLIP_NAMES)])[2])
            for i, (rec, _) in enumerate(recs)
        ]
        print(f"  {n} sessions: rss {before:.0f} -> {rss_mb():.0f} MB, "
              f"{latched} latched to predicted, agreement vs batch "
              f"min {min(scores) * 100:.1f}% mean {statistics.fmean(scores) * 100:.1f}%")


asyncio.run(main())
