#!/usr/bin/env python3
"""Fit the two constants the fast viseme leg predicts sentence length with.

The fast leg turns text into mouth shapes by stretching a predicted phone
timeline over a duration. It is *extremely* sensitive to that duration: measured
over a real corpus, a 10% error costs ~20 points of frame agreement and a 20%
error costs ~35 — duration accuracy is the ballgame. So the estimator is not a
nicety around the edge of the feature; it is most of the feature.

`ms = MS_PER_CHAR * chars + ONSET_MS`, one pair of numbers, printed here and
pasted into `durations.py`. Characters beat words comfortably and adding words as
a second feature earns nothing; `onset_ms` is the fixed lead-in every utterance
pays before the first phone is fully articulated, and without it a bare rate
badly under-predicts interjections.

The training data is `tests/fixtures/duration_corpus.json` — the same sentences
spoken by both shipped vql-speech voices, timed by the bytes that came back.
Re-measure it with `scripts/measure_durations.py` (needs the credential), then
re-run this. Every 5th clip in corpus order is held out, and
`tests/test_durations.py` scores the shipped constants against exactly those.

Usage:

    python scripts/fit_durations.py
    python scripts/fit_durations.py --corpus /path/to/other.json
"""

from __future__ import annotations

import argparse
import json
import statistics
from dataclasses import dataclass
from pathlib import Path

CORPUS = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "duration_corpus.json"

# Every 5th clip in corpus order is held out. Deterministic, and shared with
# `tests/test_durations.py`, so the shipped constants and the test always
# disagree about exactly the same clips and the test's numbers are genuinely
# out-of-sample.
HOLDOUT_STRIDE = 5


@dataclass
class Clip:
    text: str
    ms: float
    voice: str


def load_clips(path: Path) -> list[Clip]:
    raw = json.loads(path.read_text())
    return [
        Clip(text=e["text"], ms=float(e["audio_ms"]), voice=e["voice"]) for e in raw["clips"]
    ]


def fit(clips: list[Clip]) -> tuple[float, float]:
    """Least squares for ms = a*chars + b, weighted by 1/ms.

    Weighting by 1/ms minimises *relative* error, which is what the fast leg
    actually cares about — a 200 ms miss on a 3 s sentence is invisible and the
    same miss on a 600 ms interjection is a wrong mouth.
    """
    n = len(clips)
    if n < 2:
        raise ValueError("need at least two clips to fit")
    sw = sxw = syw = sxxw = sxyw = 0.0
    for clip in clips:
        w = 1.0 / clip.ms
        x = float(len(clip.text))
        sw += w
        sxw += w * x
        syw += w * clip.ms
        sxxw += w * x * x
        sxyw += w * x * clip.ms
    denominator = sw * sxxw - sxw * sxw
    a = (sw * sxyw - sxw * syw) / denominator
    b = (syw - a * sxw) / sw
    return a, b


def errors(clips: list[Clip], a: float, b: float) -> list[float]:
    return [abs(a * len(c.text) + b - c.ms) / c.ms for c in clips]


def report(label: str, clips: list[Clip], a: float, b: float) -> None:
    if not clips:
        return
    err = sorted(errors(clips, a, b))
    print(
        f"  {label:22} n={len(err):4}  median={statistics.median(err):6.1%}  "
        f"p90={err[int(0.9 * len(err))]:6.1%}  worst={err[-1]:6.1%}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=CORPUS)
    args = parser.parse_args()

    clips = load_clips(args.corpus)
    # One model, not one per voice. The library is handed a sentence and nothing
    # else — `AvatarProcessor()` takes no arguments and never learns which voice
    # the TTS opened its context with — so a per-voice table could only ever be
    # consulted at its fallback. Pooling the voices makes that honest, and the
    # per-voice error below is what says whether pooling costs anything.
    train = [c for i, c in enumerate(clips) if i % HOLDOUT_STRIDE != 0]
    holdout = [c for i, c in enumerate(clips) if i % HOLDOUT_STRIDE == 0]
    a, b = fit(train)

    print(f"\nMS_PER_CHAR = {a:.4f}\nONSET_MS = {b:.1f}\n")
    print(f"held out every {HOLDOUT_STRIDE}th of {len(clips)} clips:")
    report("both voices", holdout, a, b)
    for voice in sorted({c.voice for c in clips}):
        report(voice, [c for c in holdout if c.voice == voice], a, b)
    print("\nin-sample, for comparison:")
    report("both voices", train, a, b)
    print("\nPaste the two constants into src/voqalize_avatar/durations.py.")


if __name__ == "__main__":
    main()
