"""Record the canned corpus, once per voice. Reads `lines.json`, writes `audio/`.

    cd server && uv run --with "cartesia[websockets]>=3,<4" --with "pyjwt[crypto]" python record.py
    cd server && uv run --with "cartesia[websockets]>=3,<4" --with "pyjwt[crypto]" python record.py male

`<4` is load-bearing: cartesia 4 negotiates a newer API version and the handshake
comes back 403, which reads exactly like an untrusted key. `[crypto]` is the half
of PyJWT that can do RS256 — without it the failure is a `NotImplementedError`
naming the algorithm. Neither is in a dependency group, because this is a tool
run twice a year and `--group server-vendors` carries the *runtime* vendors:
pipecat speaks Cartesia's protocol over raw websockets and does not pull the SDK.

Run this after editing the text in `lines.json`. It is the checked-in answer to
a question the repo could not previously answer: the clips in `authoring/*-audio/`
were spoken on somebody's laptop by a command nobody wrote down, so "how do I add
a line?" had no answer but "ask whoever made the last one".

**The recorded voice and the streamed voice are now the same voice.** Each row in
`lines.json` carries one id — `omnivoice/gauri`, `omnivoice/gaurav` — and this
script asks vql-speech for exactly what `--tts vql-speech` asks for in a live
call. That closes a gap the old recorder could not: it spoke a licence-clean
piper stand-in, so `--tts canned` and `--tts vql-speech` were two different
people, and the default path — the only one anybody runs first — was the one
nobody was shipping. A voice that contradicts the face is read as a mistake long
before any animation defect is, and a stand-in is a contradiction with extra
steps.

**The credential is not in this repo and never will be.** vql-speech takes a
self-signed RS256 JWT, so recording needs the private half of a key the service
already trusts; point `VQL_SPEECH_KEY_PEM` at it. Everything committed here is
public, which is also why the *output* is committed: a reader who clones this
repo should hear the avatar without holding a key, and a few MB of speech is the
cheapest way to promise that.

Neither the key nor the host has a default, for the same reason `bot.py`'s
`--tts vql-speech` gives neither one: both would be Voqalize's infrastructure,
written down in a repository anybody can read.

    VQL_SPEECH_HOST=speech.<env>.example.com
    VQL_SPEECH_KEY_PEM=/path/to/signing-key.pem
"""

from __future__ import annotations

import array
import json
import os
import sys
import time
import wave
from pathlib import Path
from typing import Any

import cartesia  # type: ignore[import-not-found]
import jwt as pyjwt

HERE = Path(__file__).parent
MODEL_ID = "sonic-2"


def _env(name: str, why: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is unset — {why}. Nothing about vql-speech is in this repo.")
    return value


def _token() -> str:
    """A short-lived RS256 assertion, signed by a key vql-speech already trusts."""
    pem = _env("VQL_SPEECH_KEY_PEM", "recording needs a signing key the service trusts")
    now = int(time.time())
    return pyjwt.encode(
        {
            "iss": "https://test.local",
            "aud": "vql-speech",
            "sub": "avatar-corpus",
            "iat": now,
            "exp": now + 3600,
        },
        Path(pem).read_text(),
        algorithm="RS256",
    )


def _synthesise(client: Any, *, text: str, voice: str, sample_rate: int) -> bytes:
    """One sentence, one websocket turn. Raw PCM, exactly as pipecat receives it.

    `container: raw` rather than `wav`: the header vql-speech would write is not
    the one we want anyway (we re-declare the rate below against `lines.json`),
    and a header arriving mid-stream is a class of bug worth not having.
    """
    chunks: list[bytes] = []
    ws = client.tts.websocket()
    try:
        for chunk in ws.send(
            model_id=MODEL_ID,
            transcript=text,
            voice={"mode": "id", "id": voice},
            output_format={
                "container": "raw",
                "encoding": "pcm_s16le",
                "sample_rate": sample_rate,
            },
            stream=True,
        ):
            audio = chunk.get("audio") if isinstance(chunk, dict) else getattr(chunk, "audio", None)
            if audio:
                chunks.append(audio)
    finally:
        ws.close()
    return b"".join(chunks)


def record(client: Any, voice: str, spec: dict, sentences: list[dict], sample_rate: int) -> int:
    out_dir = HERE / "audio" / voice
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n{voice} — {spec['vql_speech']} → {out_dir}")

    for s in sentences:
        out = out_dir / s["audio"]
        pcm = _synthesise(client, text=s["text"], voice=spec["vql_speech"], sample_rate=sample_rate)

        # Every way this fails looks identical at runtime — the mouth moves and
        # no sound comes out, which reads as a lipsync bug and is not one. So
        # the silent clip is caught here, where the text that produced it is
        # still on screen, rather than at load or in someone's headphones.
        samples = array.array("h")
        samples.frombytes(pcm)
        peak = max((abs(v) for v in samples), default=0)
        if peak == 0:
            raise SystemExit(f"{voice}/{out.name}: {len(pcm)} bytes of silence for {s['text']!r}")

        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sample_rate)
            w.writeframes(pcm)

        ms = len(samples) / sample_rate * 1000
        print(f"  {out.name:28} {ms:6.0f} ms  peak {peak / 32768:.2f}  {s['text']}")

    return len(sentences)


def main() -> int:
    corpus = json.loads((HERE / "lines.json").read_text())
    sample_rate: int = corpus["sample_rate"]
    sentences = [s for line in corpus["lines"] for s in line["sentences"]]

    wanted = sys.argv[1:] or list(corpus["voices"])
    unknown = [v for v in wanted if v not in corpus["voices"]]
    if unknown:
        raise SystemExit(f"no voice {unknown[0]!r} in lines.json — have {list(corpus['voices'])}")

    host = _env("VQL_SPEECH_HOST", "there is no default endpoint")
    client = cartesia.Cartesia(
        api_key=_token(),
        base_url=f"https://{host}",
        websocket_base_url=f"wss://{host}",
    )

    written = sum(
        record(client, v, corpus["voices"][v], sentences, sample_rate) for v in wanted
    )
    total = sum(f.stat().st_size for f in (HERE / "audio").rglob("*.wav"))
    print(f"\n{written} clips over {len(wanted)} voice(s); audio/ is now {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
