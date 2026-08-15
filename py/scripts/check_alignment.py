"""Measure whether a cue track is in phase with the audio it describes.

    cd py && uv run python scripts/check_alignment.py

The one thing about lipsync that cannot be judged by eye without a controlled
listening setup: a uniform shift. Every browser plays audio later than
`currentTime` says — 30 ms on speakers, 150-300 ms over Bluetooth — so a mouth
that is visibly early tells you nothing about the cues until that is nulled out.
This measures the cues against the samples directly, where no playback path
exists to confuse the question.

Speech activity, not aperture, is the signal. A mouth-openness curve correlated
against an amplitude envelope sounds more principled and is much worse: the
mouth legitimately closes mid-word on every /p/ and /m/, so the two curves
disagree constantly for reasons that have nothing to do with timing, and the
correlation peak wanders. Whether the mouth is *doing something* against whether
there is *sound* has no such ambiguity, and it is also what a viewer reads as
in-sync — you notice a mouth that opens before the voice, not one that picks the
wrong vowel.

Read `onset` first. Within one 10 ms frame is aligned. `offset` runs positive by
design — the last phone is held to the end of its own duration and the rest
shape follows, so the mouth closes after the sound stops, which is what a real
one does. `xcorr` is reported for completeness but is dominated by that tail on
short clips; do not read a shift into it that `onset` does not show.
"""

from __future__ import annotations

import array
import json
import math
import wave
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
AUTHORING = REPO / "authoring"
STEP_MS = 10  # one animation frame at 100 Hz; finer than any shift a viewer sees

# Fraction of peak RMS above which a frame counts as speech. Loose on purpose:
# the eval clips are studio-clean, and a threshold tight enough to argue about
# would be measuring the gate rather than the aligner.
SPEECH_FLOOR = 0.05


def envelope(path: Path, ms: int) -> list[float]:
    """Per-frame RMS of a 16-bit mono wav, one value per `STEP_MS`."""
    with wave.open(str(path)) as w:
        rate, count = w.getframerate(), w.getnframes()
        pcm = array.array("h")
        pcm.frombytes(w.readframes(count))
    per = int(rate * STEP_MS / 1000)
    out = []
    for i in range(ms // STEP_MS):
        seg = pcm[i * per : (i + 1) * per]
        out.append(math.sqrt(sum(float(s) * s for s in seg) / len(seg)) if seg else 0.0)
    return out


def speech(env: list[float]) -> list[int]:
    peak = max(env) or 1.0
    return [1 if v / peak > SPEECH_FLOOR else 0 for v in env]


def moving(cues: list[dict], ms: int) -> list[int]:
    """1 where the cue track holds a shape other than rest."""
    out, k = [], 0
    for i in range(ms // STEP_MS):
        t = i * STEP_MS
        while k + 1 < len(cues) and cues[k + 1]["t"] <= t:
            k += 1
        out.append(0 if cues[k]["v"] == "X" or cues[k]["t"] > t else 1)
    return out


def edges(sig: list[int]) -> tuple[int, int]:
    """`(first, last+1)` frame indices where the signal is high."""
    first = next((i for i, v in enumerate(sig) if v), 0)
    last = next((len(sig) - i for i, v in enumerate(reversed(sig)) if v), 0)
    return first, last


def best_lag(a: list[int], b: list[int], span: int = 40) -> tuple[int, float]:
    """Frame shift of `a` against `b` maximising correlation. Positive = later."""
    best, at, n = -2.0, 0, len(a)
    for lag in range(-span, span + 1):
        xs = [(a[i - lag], b[i]) for i in range(n) if 0 <= i - lag < n]
        if len(xs) < 20:
            continue
        ma = sum(x for x, _ in xs) / len(xs)
        mb = sum(y for _, y in xs) / len(xs)
        da = math.sqrt(sum((x - ma) ** 2 for x, _ in xs))
        db = math.sqrt(sum((y - mb) ** 2 for _, y in xs))
        if not da or not db:
            continue
        r = sum((x - ma) * (y - mb) for x, y in xs) / (da * db)
        if r > best:
            best, at = r, lag
    return at * STEP_MS, best


def main() -> None:
    clips = json.loads((AUTHORING / "lipsync-clips.json").read_text())
    names = list(clips[0]["tracks"])
    print("positive = mouth later than the sound\n")
    head = "".join(f"{n:>26}" for n in names)
    print(f"{'clip':8}{'ms':>6}{head}")
    print(f"{'':14}" + "".join(f"{'onset  offset   xcorr':>26}" for _ in names))

    totals: dict[str, list[tuple[int, int, int]]] = {n: [] for n in names}
    for c in clips:
        voice = speech(envelope(AUTHORING / c["audio"], c["ms"]))
        a_on, a_off = edges(voice)
        cells = []
        for name in names:
            mouth = moving(c["tracks"][name], c["ms"])
            m_on, m_off = edges(mouth)
            on = (m_on - a_on) * STEP_MS
            off = (m_off - a_off) * STEP_MS
            lag, _ = best_lag(mouth, voice)
            totals[name].append((on, off, lag))
            cells.append(f"{on:+6d}{off:+8d}{lag:+8d}  ")
        print(f"{c['id']:8}{c['ms']:>6}" + "".join(cells))

    print()
    for name, rows in totals.items():
        n = len(rows)
        print(
            f"{name:6} mean onset {sum(r[0] for r in rows) / n:+7.1f} ms"
            f"   mean offset {sum(r[1] for r in rows) / n:+7.1f} ms"
            f"   mean xcorr {sum(r[2] for r in rows) / n:+7.1f} ms"
        )


if __name__ == "__main__":
    main()
