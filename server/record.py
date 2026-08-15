"""Record the canned corpus. Reads `lines.json`, writes `audio/`.

    uv run --with piper-tts python record.py

Run this after editing the text in `lines.json`. It is the checked-in answer to
a question the repo could not previously answer: the clips in `authoring/*-audio/`
were spoken by piper on somebody's laptop by a command nobody wrote down, so
"how do I add a line?" had no answer but "ask whoever made the last one".

**Voices are chosen for their licence, not their sound.** `en_US-ljspeech-high`
is trained on LJSpeech, which is public domain; the fallback `en_US-libritts_r`
is CC BY 4.0. Both are already credited in the repo README. This repository is
public and AGPL, and every WAV in it is redistributed to everyone who clones it
— which rules out the obvious shortcut of macOS `say`, whose voices are Apple's
to license and not ours to ship.

The model is ~60 MB and downloaded on first run into `.voices/`, which is
gitignored. That download is why the output WAVs *are* committed: a reader who
clones this repo should be able to hear the avatar talk without fetching a
speech model first, and 2 MB of speech is a cheaper way to promise that than
any of the alternatives.
"""

from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).parent
VOICES = HERE / ".voices"


def main() -> int:
    corpus = json.loads((HERE / "lines.json").read_text())
    voice: str = corpus["voice"]
    sample_rate: int = corpus["sample_rate"]

    model = VOICES / f"{voice}.onnx"
    if not model.exists():
        print(f"fetching {voice} (~60 MB, once) …")
        VOICES.mkdir(exist_ok=True)
        subprocess.run(
            [sys.executable, "-m", "piper.download_voices", "--download-dir", str(VOICES), voice],
            check=True,
        )

    sentences = [s for line in corpus["lines"] for s in line["sentences"]]
    print(f"{len(sentences)} sentences → {HERE / 'audio'}")

    written = 0
    for s in sentences:
        out = HERE / s["audio"]
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["piper", "-m", str(model), "-f", str(out)],
            input=s["text"],
            text=True,
            check=True,
            capture_output=True,
        )

        # Piper's rate is a property of the voice, so a voice swap can silently
        # change it and every clip would then play at the wrong pitch through a
        # resampler that was told otherwise. Check, do not assume.
        with wave.open(str(out)) as w:
            if w.getframerate() != sample_rate:
                raise SystemExit(
                    f"{out.name}: {voice} emits {w.getframerate()} Hz but lines.json "
                    f"declares {sample_rate}. Update sample_rate and re-record all."
                )
            if w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise SystemExit(f"{out.name}: need mono 16-bit")
            ms = w.getnframes() / w.getframerate() * 1000
        print(f"  {out.name:28} {ms:6.0f} ms  {s['text']}")
        written += 1

    total = sum(f.stat().st_size for f in (HERE / "audio").glob("*.wav"))
    print(f"\n{written} clips, {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
