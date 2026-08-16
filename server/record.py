"""Record the canned corpus, once per voice. Reads `lines.json`, writes `audio/`.

    uv run --with piper-tts python record.py            # every voice
    uv run --with piper-tts python record.py male       # just one

Run this after editing the text in `lines.json`. It is the checked-in answer to
a question the repo could not previously answer: the clips in `authoring/*-audio/`
were spoken by piper on somebody's laptop by a command nobody wrote down, so
"how do I add a line?" had no answer but "ask whoever made the last one".

**The recorded voices are stand-ins, and the real ones are in `lines.json` too.**
Each voice there carries a `vql_speech` id — `omnivoice/gauri`, `omnivoice/gaurav`
— which is what `--tts vql-speech` asks for and what a production call actually
hears. Those cannot be recorded into this repo: the service needs a signed
credential, and this repository is public. So each voice also names a `piper`
model to stand in with, and the pairing lives in one row so the two backends
cannot disagree about which voice is speaking.

**Piper models are chosen for their licence, not their sound.**
`en_US-ljspeech-high` is trained on LJSpeech, which is public domain;
`en_US-joe-medium` on the OHF-Voice set, which is CC0. Both are already credited
in the repo README. This repository is public and AGPL, and every WAV in it is
redistributed to everyone who clones it — which rules out the obvious shortcut
of macOS `say`, whose voices are Apple's to license and not ours to ship, and
rules out the better-sounding piper voices too: `ryan` and `hfc_male` are the
obvious male candidates and both are CC BY-NC-SA.

Each model is ~60 MB and downloaded on first run into `.voices/`, which is
gitignored. That download is why the output WAVs *are* committed: a reader who
clones this repo should be able to hear the avatar talk without fetching a
speech model first, and a couple of MB of speech is a cheaper way to promise
that than any of the alternatives.
"""

from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).parent
VOICES = HERE / ".voices"


def _model(piper: str) -> Path:
    """The onnx for a piper voice, fetched on first use."""
    model = VOICES / f"{piper}.onnx"
    if not model.exists():
        print(f"fetching {piper} (~60 MB, once) …")
        VOICES.mkdir(exist_ok=True)
        subprocess.run(
            [sys.executable, "-m", "piper.download_voices", "--download-dir", str(VOICES), piper],
            check=True,
        )
    return model


def record(voice: str, spec: dict, sentences: list[dict], sample_rate: int) -> int:
    model = _model(spec["piper"])
    out_dir = HERE / "audio" / voice
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n{voice} — {spec['piper']} → {out_dir}")

    for s in sentences:
        out = out_dir / s["audio"]
        subprocess.run(
            ["piper", "-m", str(model), "-f", str(out)],
            input=s["text"],
            text=True,
            check=True,
            capture_output=True,
        )

        # Piper's rate is a property of the voice, so a voice swap can silently
        # change it and every clip would then play at the wrong pitch through a
        # resampler that was told otherwise. Check, do not assume — and check it
        # per voice, because the whole point of this file is that there is now
        # more than one model in play.
        with wave.open(str(out)) as w:
            if w.getframerate() != sample_rate:
                raise SystemExit(
                    f"{voice}/{out.name}: {spec['piper']} emits {w.getframerate()} Hz but "
                    f"lines.json declares {sample_rate}. Pick another model, or update "
                    f"sample_rate and re-record every voice."
                )
            if w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise SystemExit(f"{voice}/{out.name}: need mono 16-bit")
            ms = w.getnframes() / w.getframerate() * 1000
        print(f"  {out.name:28} {ms:6.0f} ms  {s['text']}")

    return len(sentences)


def main() -> int:
    corpus = json.loads((HERE / "lines.json").read_text())
    sample_rate: int = corpus["sample_rate"]
    sentences = [s for line in corpus["lines"] for s in line["sentences"]]

    wanted = sys.argv[1:] or list(corpus["voices"])
    unknown = [v for v in wanted if v not in corpus["voices"]]
    if unknown:
        raise SystemExit(f"no voice {unknown[0]!r} in lines.json — have {list(corpus['voices'])}")

    written = sum(record(v, corpus["voices"][v], sentences, sample_rate) for v in wanted)
    total = sum(f.stat().st_size for f in (HERE / "audio").rglob("*.wav"))
    print(f"\n{written} clips over {len(wanted)} voice(s); audio/ is now {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
