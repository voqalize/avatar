#!/usr/bin/env python3
"""Extract real Rhubarb output for a sample of a TTS phrase cache.

A phrase cache is the ideal evaluation set: it holds the actual synthesised
audio for a phrase *and* the text that produced it, so the text-only path and
the acoustic path can be run against identical input.

Emits, per clip: the pocketSphinx shape track (with dialog -- Rhubarb's best),
the phonetic shape track (as an in-family yardstick), and the raw phone timeline
parsed out of the Debug log, which is what the duration table is fitted to.
"""
import concurrent.futures as cf
import json
import os
import pathlib
import random
import re
import struct
import subprocess
import sys

# Paths are env-overridable so this runs outside the tree it was written in.
#   RHUBARB_BUILD  build dir holding the binaries and res/ (default ../build)
#   PHRASE_CACHE   a directory of `<key>.pcm` clips plus the manifest naming
#                  their text and duration. Required — there is no default; the
#                  corpus this was measured against is not ours to publish.
HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE.parent
BUILD = pathlib.Path(os.environ.get("RHUBARB_BUILD", DATA / "build"))
CACHE = pathlib.Path(os.environ["PHRASE_CACHE"])
RHUBARB = BUILD / "rhubarb"
WAVDIR = DATA / "gt_wav"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 200

PHONE_RE = re.compile(r"##phone\[(\d+\.\d+)-(\d+\.\d+)\]: (\w+)")


def write_wav(pcm: bytes, path: pathlib.Path, rate: int = 24000) -> None:
    n = len(pcm)
    hdr = b"RIFF" + struct.pack("<I", 36 + n) + b"WAVEfmt " + struct.pack(
        "<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", n)
    path.write_bytes(hdr + pcm)


def run(entry):
    wav = WAVDIR / (entry["file"].replace(".pcm", ".wav"))
    dlg = WAVDIR / (entry["file"].replace(".pcm", ".txt"))
    write_wav((CACHE / entry["file"]).read_bytes(), wav)
    dlg.write_text(entry["text"])

    out = {"key": entry["key"], "text": entry["text"], "audio_ms": entry["audio_ms"]}
    for name, args in (
        ("ps", ["-r", "pocketSphinx", "-d", str(dlg)]),
        ("ph", ["-r", "phonetic"]),
    ):
        p = subprocess.run(
            [str(RHUBARB), "-f", "json", "--extendedShapes", "GHX",
             "--consoleLevel", "Debug", "--threads", "1", *args, str(wav)],
            capture_output=True, text=True, cwd=RHUBARB.parent)
        if p.returncode != 0:
            out[name] = None
            continue
        try:
            j = json.loads(p.stdout)
        except json.JSONDecodeError:
            out[name] = None
            continue
        out[name] = [{"t": round(c["start"] * 1000), "v": c["value"]}
                     for c in j["mouthCues"]]
        if name == "ps":
            out["phones"] = [
                {"s": round(float(a) * 1000), "e": round(float(b) * 1000), "p": p_}
                for a, b, p_ in PHONE_RE.findall(p.stderr)]
    return out


def main() -> None:
    WAVDIR.mkdir(exist_ok=True)
    entries = json.loads((CACHE / "manifest.json").read_text())["entries"]
    # Stratify by duration so the sample is not dominated by one-word phrases,
    # which is what a uniform draw over this cache gives you.
    entries.sort(key=lambda e: e["audio_ms"])
    rng = random.Random(7)
    buckets = 10
    per = max(1, N // buckets)
    size = len(entries) // buckets
    sample = []
    for i in range(buckets):
        chunk = entries[i * size:(i + 1) * size] or entries[i * size:]
        sample += rng.sample(chunk, min(per, len(chunk)))

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(run, sample))

    ok = [r for r in results if r.get("ps") and r.get("ph")]
    (DATA / "groundtruth.json").write_text(json.dumps(ok))
    print(f"{len(ok)}/{len(sample)} clips, "
          f"{sum(len(r.get('phones', [])) for r in ok)} phones")


if __name__ == "__main__":
    main()
