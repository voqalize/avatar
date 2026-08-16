"""Record the canned corpus, once per voice. Reads `lines.json`, writes `audio/`.

Two artefacts per voice, recorded in one pass so they cannot disagree: the WAVs,
and `audio/<voice>/timings.json` — **vql-speech's own word timestamps**, asked
for with `add_timestamps=True` and written down verbatim. The canned TTS replays
them rather than estimating its own, which is what makes the default path's
karaoke the same data a live `--tts vql-speech` call would carry.

That mattered more than it sounds. The recorder used to save audio only, and
`canned.py` spread each sentence's words over the clip by character share — the
right *algorithm* (it is what vql-speech does too) applied to the wrong
*baseline*: pipecat stamps word timings against the start of the whole turn's
audio context, so every sentence after the first replayed the first sentence's
clock. On the two-sentence `greet` line the second sentence's first word landed
at 0 ms instead of 890 ms, and the transcript finished 1.4 s before the voice
did.

    cd server && uv run --with "cartesia[websockets]>=3,<4" --with "pyjwt[crypto]" python record.py
    cd server && uv run --with "cartesia[websockets]>=3,<4" --with "pyjwt[crypto]" python record.py male

`<4` is load-bearing: cartesia 4 negotiates a newer API version and the handshake
comes back 403, which reads exactly like an untrusted key. `[crypto]` is the half
of PyJWT that can do RS256 — without it the failure is a `NotImplementedError`
naming the algorithm. Neither is in a dependency group, because this is a tool
run twice a year and `--group server-vendors` carries the *runtime* vendors:
pipecat speaks Cartesia's protocol over raw websockets and does not pull the SDK.

Run this after editing the text in `lines.json`. It is the checked-in answer to
a question the repo could not previously answer: the clips in `apps/authoring/*-audio/`
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


def _get(obj: Any, key: str) -> Any:
    """The SDK hands back dicts on some frames and models on others."""
    return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)


def _synthesise(
    client: Any, *, text: str, voice: str, sample_rate: int
) -> tuple[bytes, list[str], list[float]]:
    """One sentence, one websocket turn. Raw PCM and the service's own word times.

    `container: raw` rather than `wav`: the header vql-speech would write is not
    the one we want anyway (we re-declare the rate below against `lines.json`),
    and a header arriving mid-stream is a class of bug worth not having.

    `add_timestamps` is what a live `--tts vql-speech` call asks for too, so what
    comes back here is what pipecat's Cartesia service would have received. The
    starts are relative to *this* turn because a turn is one sentence here; the
    caller is the one that knows where the sentence sits in a line.
    """
    chunks: list[bytes] = []
    words: list[str] = []
    starts: list[float] = []
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
            add_timestamps=True,
            stream=True,
        ):
            audio = _get(chunk, "audio")
            if audio:
                chunks.append(audio)
            timestamps = _get(chunk, "word_timestamps")
            if timestamps is not None:
                got = _get(timestamps, "words")
                at = _get(timestamps, "start")
                if got and at is not None:
                    words += list(got)
                    starts += [float(v) for v in at]
    finally:
        ws.close()
    return b"".join(chunks), words, starts


def record(client: Any, voice: str, spec: dict, sentences: list[dict], sample_rate: int) -> int:
    out_dir = HERE / "audio" / voice
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n{voice} — {spec['vql_speech']} → {out_dir}")

    timings: dict[str, Any] = {}
    for s in sentences:
        out = out_dir / s["audio"]
        pcm, words, starts = _synthesise(
            client, text=s["text"], voice=spec["vql_speech"], sample_rate=sample_rate
        )

        # Every way this fails looks identical at runtime — the mouth moves and
        # no sound comes out, which reads as a lipsync bug and is not one. So
        # the silent clip is caught here, where the text that produced it is
        # still on screen, rather than at load or in someone's headphones.
        samples = array.array("h")
        samples.frombytes(pcm)
        peak = max((abs(v) for v in samples), default=0)
        if peak == 0:
            raise SystemExit(f"{voice}/{out.name}: {len(pcm)} bytes of silence for {s['text']!r}")

        # A clip whose words did not arrive would replay as a sentence the
        # karaoke path skips entirely — silent in exactly the same way as the
        # above, one layer up.
        if len(words) != len(s["text"].split()):
            raise SystemExit(
                f"{voice}/{out.name}: {len(words)} word timings for "
                f"{len(s['text'].split())} words in {s['text']!r}"
            )

        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sample_rate)
            w.writeframes(pcm)

        ms = len(samples) / sample_rate * 1000
        timings[s["audio"]] = {
            "ms": round(ms, 1),
            "words": words,
            # Milliseconds, because everything downstream of here counts in
            # them; seconds are the wire's unit, not ours.
            "start_ms": [round(v * 1000, 1) for v in starts],
        }
        print(f"  {out.name:28} {ms:6.0f} ms  peak {peak / 32768:.2f}  {s['text']}")

    (out_dir / "timings.json").write_text(
        json.dumps(
            {
                "_": (
                    "vql-speech's own word timestamps, as `add_timestamps` returned them, "
                    "recorded in the same pass as the WAVs beside this file. `start_ms` is "
                    "relative to the start of its own clip; the canned TTS adds the offset "
                    "of the sentence within the turn, which is the baseline pipecat stamps "
                    "against. Regenerate with apps/server/record.py — never by hand."
                ),
                "voice": spec["vql_speech"],
                "sample_rate": sample_rate,
                "sentences": timings,
            },
            indent=1,
            ensure_ascii=False,
        )
        + "\n"
    )
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
