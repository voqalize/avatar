#!/usr/bin/env python3
"""Speak the duration corpus through vql-speech and record how long each one took.

The fast viseme leg predicts a sentence's length before any of its audio exists,
and `durations.py` is that prediction. A prediction is only as good as the thing
it was fitted against, so this is the measuring step: the same texts, spoken by
the voices the avatar actually ships with, timed by the byte count that came back.

    cd py && \
      VQL_SPEECH_HOST=speech.<env>.example.com \
      VQL_SPEECH_KEY_PEM=/path/to/signing-key.pem \
      uv run --with "cartesia[websockets]>=3,<4" --with "pyjwt[crypto]" \
        python scripts/measure_durations.py

Writes `tests/fixtures/duration_corpus.json`, which `scripts/fit_durations.py`
then fits and `tests/test_durations.py` scores against. Re-measuring keeps the
text and refreshes the timings, so a re-fit after a voice or engine change is
this command followed by that one.

**The text is committed and the timings are measured; neither is a private
corpus.** The sentences are authored for the purpose and have been in this
repository since the piper fit — what changed is who speaks them. The credential
is not here and never will be, for the same reason `apps/server/record.py` has no
default host or key: everything committed in this repo is public.

`<4` on the cartesia pin and `[crypto]` on PyJWT are both load-bearing — see
`apps/server/record.py`, which dials the same service the same way.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import cartesia  # type: ignore[import-not-found]
import jwt as pyjwt

CORPUS = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "duration_corpus.json"
MODEL_ID = "sonic-2"
SAMPLE_RATE = 24_000

#: The voices the avatar ships with, and the only ones this fit is a claim
#: about. `apps/server/lines.json` names the same two ids for the same reason.
VOICES = ("omnivoice/gauri", "omnivoice/gaurav")


def _env(name: str, why: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is unset — {why}. Nothing about vql-speech is in this repo.")
    return value


def _token() -> str:
    """A short-lived RS256 assertion, signed by a key vql-speech already trusts."""
    pem = _env("VQL_SPEECH_KEY_PEM", "measuring needs a signing key the service trusts")
    now = int(time.time())
    return pyjwt.encode(
        {
            "iss": "https://test.local",
            "aud": "vql-speech",
            "sub": "avatar-durations",
            "iat": now,
            "exp": now + 3600,
        },
        Path(pem).read_text(),
        algorithm="RS256",
    )


def speak_ms(client: Any, text: str, voice: str) -> float:
    """How many milliseconds of audio this sentence produced.

    Counted from the bytes on the wire rather than from any header, because that
    is the number vql-speech itself divides by 24 kHz when it decides where the
    words in a sentence fall — so the corpus and the service agree by
    construction rather than by convention.
    """
    total = 0
    ws = client.tts.websocket()
    try:
        for chunk in ws.send(
            model_id=MODEL_ID,
            transcript=text,
            voice={"mode": "id", "id": voice},
            output_format={
                "container": "raw",
                "encoding": "pcm_s16le",
                "sample_rate": SAMPLE_RATE,
            },
            stream=True,
        ):
            audio = chunk.get("audio") if isinstance(chunk, dict) else getattr(chunk, "audio", None)
            if audio:
                total += len(audio)
    finally:
        ws.close()
    if total == 0:
        raise SystemExit(f"{voice}: no audio for {text!r}")
    return total / 2 / SAMPLE_RATE * 1000.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--texts",
        type=Path,
        help="One sentence per line, for a fresh corpus. Default: re-measure the committed one.",
    )
    parser.add_argument("--out", type=Path, default=CORPUS)
    # One websocket turn per sentence, and a few hundred sentences: sequential
    # is twenty minutes of waiting on a round trip. Each worker opens its own
    # socket, so nothing is shared but the client's credentials.
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    if args.texts:
        texts = [t.strip() for t in args.texts.read_text().splitlines() if t.strip()]
    else:
        existing = json.loads(CORPUS.read_text())
        seen: dict[str, None] = {}
        for entry in existing["clips"]:
            seen.setdefault(entry["text"], None)
        texts = list(seen)

    host = _env("VQL_SPEECH_HOST", "there is no default endpoint")
    client = cartesia.Cartesia(
        api_key=_token(),
        base_url=f"https://{host}",
        websocket_base_url=f"wss://{host}",
    )

    clips: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for voice in VOICES:
            print(f"\n{voice} — {len(texts)} sentences")
            for i, (text, ms) in enumerate(
                zip(texts, pool.map(lambda t: speak_ms(client, t, voice), texts)), 1
            ):
                clips.append({"text": text, "voice": voice, "audio_ms": round(ms, 1)})
                print(f"  {i:3}/{len(texts)}  {ms:7.1f} ms  {text[:60]}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {
                "_": (
                    "Measured by scripts/measure_durations.py against vql-speech. "
                    "audio_ms is the wire byte count at 24 kHz — the same number the "
                    "service divides to place word timestamps. Fitted by "
                    "scripts/fit_durations.py; see tests/fixtures/README.md."
                ),
                "clips": clips,
            },
            indent=1,
            ensure_ascii=False,
        )
        + "\n"
    )
    print(f"\nwrote {len(clips)} clips to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
