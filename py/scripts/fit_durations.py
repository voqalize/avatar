#!/usr/bin/env python3
"""Fit the per-voice duration table the fast viseme leg depends on.

The fast leg turns text into mouth shapes by stretching a predicted phone
timeline over a duration. It is *extremely* sensitive to that duration: measured
over a real corpus, a 10% error costs ~20 points of frame agreement and a 20%
error costs ~35 (avatar `experiments/rhubarb-textsync/README.md`, "Duration
accuracy is the whole ballgame"). So the estimator is not a nicety around the
edge of the feature; it is most of the feature.

The training data is a corpus of real TTS output: text, and the exact duration
of the audio it produced. The table shipped in `duration_table.json` is fitted
against 600 utterances per voice, stratified across character length, spoken by
two openly licensed piper voices (`reference/a`, `reference/b`) — pure speech,
with none of the 250 ms inter-sentence pad the streaming wire adds.

Those two are a starting point, not a claim about your TTS. Point `--cache` at
a directory of `{text, audio_ms}` clips from the voices you actually ship and
re-fit; a voice the table has never seen degrades to the cross-voice mean, which
costs the fast leg accuracy and the accurate leg nothing.

Usage:

    python scripts/fit_durations.py                      # fit + rewrite the table
    python scripts/fit_durations.py --dry-run            # print, change nothing
    python scripts/fit_durations.py --cache /path/to/corpus
    python scripts/fit_durations.py --emit-holdout PATH  # test fixture

Writes `src/voqalize_avatar/duration_table.json`.
"""

from __future__ import annotations

import argparse
import json
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CACHE = Path(__file__).resolve().parents[1] / "corpus"
TABLE_PATH = Path(__file__).resolve().parents[1] / "src" / "voqalize_avatar" / "duration_table.json"

# Every 5th clip in manifest order is held out. Deterministic, so the committed
# coefficients and the test fixture always disagree about exactly the same
# clips, and the test's numbers are genuinely out-of-sample.
HOLDOUT_STRIDE = 5


@dataclass
class Clip:
    text: str
    ms: float
    voice: str
    lang: str


def load_clips(cache: Path) -> list[Clip]:
    manifest = json.loads((cache / "manifest.json").read_text())
    return [
        Clip(text=e["text"], ms=float(e["audio_ms"]), voice=e["voice"], lang=e["lang"])
        for e in manifest["entries"]
    ]


def fit(clips: list[Clip]) -> tuple[float, float]:
    """Least squares for ms = a*chars + b, weighted by 1/ms.

    Weighting by 1/ms minimises *relative* error, which is what the fast leg
    actually cares about — a 200 ms miss on a 3 s sentence is invisible and the
    same miss on a 600 ms interjection is a wrong mouth.

    Word count was tried as a second feature and earns nothing (its coefficient
    comes out slightly negative and the median error does not move), so the
    model stays two parameters: characters and a fixed onset.
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--emit-holdout", type=Path)
    args = parser.parse_args()

    clips = load_clips(args.cache)
    groups: dict[tuple[str, str], list[Clip]] = {}
    for clip in clips:
        groups.setdefault((clip.voice, clip.lang), []).append(clip)

    table: dict[str, Any] = {
        "_": (
            "Fitted by scripts/fit_durations.py; see py/tests/fixtures/README.md "
            "for the corpus. "
            "ms = ms_per_char * len(text) + onset_ms, per (voice, lang). "
            "Every 5th clip in manifest order is held out; the errors below are "
            "out-of-sample."
        ),
        "voices": {},
    }
    holdout: list[dict[str, Any]] = []

    for (voice, lang), group in sorted(groups.items()):
        train = [c for i, c in enumerate(group) if i % HOLDOUT_STRIDE != 0]
        test = [c for i, c in enumerate(group) if i % HOLDOUT_STRIDE == 0]
        a, b = fit(train)
        err = errors(test, a, b)
        err.sort()
        entry = {
            "ms_per_char": round(a, 4),
            "onset_ms": round(b, 2),
            "n_train": len(train),
            "n_holdout": len(test),
            "median_rel_err": round(statistics.median(err), 4),
            "p90_rel_err": round(err[int(0.9 * len(err))], 4),
        }
        table["voices"][f"{voice}|{lang}"] = entry
        print(f"{voice}|{lang}: {entry}")
        holdout += [
            {"text": c.text, "audio_ms": c.ms, "voice": c.voice, "lang": c.lang} for c in test
        ]

    if args.emit_holdout:
        args.emit_holdout.parent.mkdir(parents=True, exist_ok=True)
        args.emit_holdout.write_text(json.dumps(holdout, indent=1, ensure_ascii=False) + "\n")
        print(f"wrote {len(holdout)} held-out clips to {args.emit_holdout}")

    if args.dry_run:
        return
    TABLE_PATH.write_text(json.dumps(table, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {TABLE_PATH}")


if __name__ == "__main__":
    main()
