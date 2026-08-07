#!/usr/bin/env python3
"""Fit relative phone durations from real Rhubarb phone timelines.

Absolute durations are useless here -- they carry the speech rate of whatever
clip they came from, and the model rescales to a duration the TTS engine has
already committed to. So each phone's duration is normalized by its own clip's
mean phone duration first; the median of that ratio is the weight.
"""
import json
import pathlib
import statistics
from collections import defaultdict

DATA = pathlib.Path(__file__).resolve().parent.parent
gt = json.loads((DATA / "groundtruth.json").read_text())

ratios = defaultdict(list)
gap_frac, lead_ms, trail_ms = [], [], []

for clip in gt:
    ph = clip.get("phones") or []
    real = [p for p in ph if p["p"] not in ("Breath", "Cough", "Smack", "Noise")]
    if len(real) < 3:
        continue
    durs = [p["e"] - p["s"] for p in real]
    mean = statistics.mean(durs)
    if mean <= 0:
        continue
    for p, d in zip(real, durs):
        ratios[p["p"]].append(d / mean)

    total = clip["audio_ms"]
    covered = sum(durs)
    gap_frac.append(1 - covered / total)
    lead_ms.append(real[0]["s"])
    trail_ms.append(total - real[-1]["e"])

table = {p: round(statistics.median(v), 3) for p, v in sorted(ratios.items())
         if len(v) >= 8}
counts = {p: len(v) for p, v in ratios.items()}

print("phone  weight   n")
for p, w in sorted(table.items(), key=lambda kv: -kv[1]):
    print(f"{p:>6} {w:6.2f} {counts[p]:5d}")

print()
print(f"clips                 {len(gap_frac)}")
print(f"non-phone fraction    median {statistics.median(gap_frac):.3f}")
print(f"lead silence ms       median {statistics.median(lead_ms):.0f}")
print(f"trail silence ms      median {statistics.median(trail_ms):.0f}")
print(f"rare/unseen phones    {sorted(set(counts) - set(table))}")

(DATA / "phone_weights.json").write_text(json.dumps(table, indent=1))
