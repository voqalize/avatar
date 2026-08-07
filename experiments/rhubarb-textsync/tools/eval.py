#!/usr/bin/env python3
"""Score the text-only path against real Rhubarb, and sweep its knobs.

The number that matters is not "agreement with pocketSphinx" in the abstract —
it is agreement *relative to how much two real Rhubarb recognizers disagree with
each other*. phonetic-vs-pocketSphinx is the in-family yardstick: if the text-only
path lands near it, its errors are the kind a user already tolerates from Rhubarb.
"""
import itertools
import json
import os
import pathlib
import statistics
import subprocess
import sys

# Paths are env-overridable so this runs outside the tree it was written in.
#   RHUBARB_BUILD  build dir holding the binaries and res/ (default ../build)
#   PHRASE_CACHE   a directory of `<key>.pcm` clips (required; see groundtruth.py)
HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE.parent
BUILD = pathlib.Path(os.environ.get("RHUBARB_BUILD", DATA / "build"))
CACHE = pathlib.Path(os.environ["PHRASE_CACHE"])
TEXTSYNC = BUILD / "textsync"
DICT = BUILD / "res" / "sphinx" / "cmudict-en-us.dict"
WEIGHTS = DATA / "phone_weights.json"

# How far open the mouth is, so a near-miss can be told from a gross one.
# A viewer reads aperture long before they read which specific shape it is.
APERTURE = {"X": 0, "A": 0, "G": 1, "B": 1, "F": 1, "H": 2, "C": 2, "E": 2, "D": 3}


def sample(cues, total_ms, step=10):
    """Cue list -> per-frame shape array. Cues are (start, shape), held."""
    out, i, cur = [], 0, "X"
    for t in range(0, total_ms, step):
        while i < len(cues) and cues[i]["t"] <= t:
            cur = cues[i]["v"]
            i += 1
        out.append(cur)
    return out


def compare(a, b, total_ms):
    fa, fb = sample(a, total_ms), sample(b, total_ms)
    n = min(len(fa), len(fb))
    if not n:
        return None
    exact = sum(x == y for x, y in zip(fa, fb)) / n
    ap = sum(abs(APERTURE[x] - APERTURE[y]) for x, y in zip(fa, fb)) / n
    closed = sum((x in "AX") == (y in "AX") for x, y in zip(fa, fb)) / n
    return exact, ap, closed


def run_textsync(clips, extra):
    """One resident process, all clips, so timing reflects the real deployment."""
    stdin = "".join(f"{int(c['audio_ms'])}\t{c['text']}\n" for c in clips)
    p = subprocess.run(
        [str(TEXTSYNC), "--dict", str(DICT), *extra],
        input=stdin, capture_output=True, text=True, cwd=TEXTSYNC.parent)
    return [json.loads(line) for line in p.stdout.splitlines() if line.strip()]


def score(clips, results, ref="ps"):
    ex, ap, cl = [], [], []
    for c, r in zip(clips, results):
        if "cues" not in r:
            continue
        m = compare(r["cues"], c[ref], int(c["audio_ms"]))
        if m:
            ex.append(m[0]); ap.append(m[1]); cl.append(m[2])
    return (statistics.mean(ex), statistics.mean(ap), statistics.mean(cl), len(ex))


def main():
    gt = json.loads((DATA / "groundtruth.json").read_text())

    # Yardstick: the two shipping recognizers, on identical audio.
    ex, ap, cl = [], [], []
    for c in gt:
        m = compare(c["ph"], c["ps"], int(c["audio_ms"]))
        if m:
            ex.append(m[0]); ap.append(m[1]); cl.append(m[2])
    print(f"{'variant':<44} {'exact':>7} {'aperr':>7} {'open/cl':>8}")
    print("-" * 70)
    print(f"{'YARDSTICK phonetic vs pocketSphinx':<44} "
          f"{statistics.mean(ex):7.1%} {statistics.mean(ap):7.2f} {statistics.mean(cl):8.1%}")
    print()

    base = run_textsync(gt, [])
    print(f"{'textsync prior weights, default gaps':<44} "
          + "{:7.1%} {:7.2f} {:8.1%}".format(*score(gt, base)[:3]))
    fitted = run_textsync(gt, ["--weights", str(WEIGHTS)])
    print(f"{'textsync fitted weights, default gaps':<44} "
          + "{:7.1%} {:7.2f} {:8.1%}".format(*score(gt, fitted)[:3]))
    print()

    if "--sweep" in sys.argv:
        best = []
        for lead, trail, tfrac, gap in itertools.product(
                (0, 30, 60), (120, 200, 280, 360), (0.15, 0.25, 0.35), (0, 20, 40)):
            r = run_textsync(gt, ["--weights", str(WEIGHTS), "--lead", str(lead),
                                  "--trail", str(trail), "--trail-frac", str(tfrac),
                                  "--word-gap", str(gap)])
            s = score(gt, r)
            best.append((s[0], lead, trail, tfrac, gap, s))
        best.sort(reverse=True)
        print("top knob settings (lead/trail/trailFrac/wordGap):")
        for s0, lead, trail, tfrac, gap, s in best[:8]:
            print(f"  lead={lead:<3} trail={trail:<4} frac={tfrac:<5} gap={gap:<3} "
                  + "{:7.1%} {:7.2f} {:8.1%}".format(*s[:3]))

    # Throughput, measured on the resident process.
    ms = [r["compute_ms"] for r in fitted if "compute_ms" in r]
    ms.sort()
    print()
    print(f"per-sentence compute: median {statistics.median(ms):.2f}ms  "
          f"p95 {ms[int(len(ms) * .95)]:.2f}ms  max {ms[-1]:.2f}ms")


if __name__ == "__main__":
    main()
