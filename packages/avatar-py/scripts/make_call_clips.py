"""Regenerate `packages/avatar-3d/tools/call-reel/clips.json` — the reel's speech.

The call reel used to speak `apps/authoring/lipsync-clips.json`, whose audio is
LJSpeech and LibriTTS: public-domain datasets, one American woman and one
audiobook reader, and neither of them a voice we ship. Two costs, and the second
is the serious one. The mouth was judged against a TTS nobody hears in
production — and *both* characters spoke in the same woman's voice, so every
reel of tushar had a man's face over a female dataset speaker. CLAUDE.md ranks
that above every animation defect: "a face read as one gender speaking in
another is the first thing anyone notices, before a single nod is judged."

So the reel speaks the corpus instead. `apps/server/audio/{female,male}/` is
recorded from vql-speech itself, one `omnivoice/*` id per row — gauri for the
women, gaurav for the men — which is the audio the avatar actually meets in a
call. tara reads female, tushar reads male, the same pairing Studio applies
(`apps/studio/src/Build.tsx` READS).

    cd packages/avatar-py && uv run python scripts/make_call_clips.py

Cues come from the **accurate leg over the real PCM**, the same
`AvatarsyncEngine` a pipecat call loads, so they carry the `i` the wire has
always specified and nothing used to populate. That is the other half of the
fix: with the old fixtures `shapeFor` defaulted every viseme to intensity 1 and
every syllable rendered at full effort, which is the "repetitive... like a
puppet's mouth" both video reviewers named.

A corpus line is one *turn* of one or more sentences, recorded a sentence per
WAV. The cue track here is the whole turn, each sentence's track shifted to
where that sentence starts, so one `speak` beat is one turn and the mouth closes
between sentences because the audio does. `run.mjs` muxes the parts at those
same offsets, so the video's clock and the WAVs' are one clock.

What this deliberately does not bake: the predicted leg. The reel plays a turn
whose audio already exists, and the two-leg interleave is a property of a live
call — watch `apps/server/` for that, as the lipsync note in CLAUDE.md says.
"""

from __future__ import annotations

import asyncio
import json
import wave
from pathlib import Path

from voqalize_avatar.avatarsync import AvatarsyncEngine, AvatarsyncPaths, Cue
from voqalize_avatar.visemes import SILENT, cues_to_wire, normalize_cues

REPO = Path(__file__).resolve().parents[3]
CORPUS = REPO / "apps" / "server"
OUT = REPO / "packages" / "avatar-3d" / "tools" / "call-reel" / "clips.json"

#: Which voice each character reads as. The same table Studio applies between
#: calls; kept here too because a reel never goes through Studio.
READS = {"tara": "female", "tushar": "male"}


def read_wav(path: Path) -> tuple[bytes, int, int]:
    """`(pcm, sample_rate, ms)` for a 16-bit mono wav."""
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
            raise SystemExit(f"{path} is not 16-bit mono")
        frames = wav.getnframes()
        rate = wav.getframerate()
        return wav.readframes(frames), rate, round(frames / rate * 1000)


#: A hold length used to *rank* lines for the reel. It is deliberately not a
#: threshold below which the mouth fails, because it was measured and it isn't
#: one: the lips smooth at MOUTH_RESPONSE_TAU_S = 0.042 s and the jaw at
#: 0.070 s, so 3-tau is ~126 ms for the lips, and pushing all 1051 corpus cues
#: through that smoothing lands a C at 92% of its authored aperture and a D at
#: 89%, with 1-5% of them under 70%. Short cues arrive. Co-articulation here is
#: the mouth chasing a moving target from wherever the last shape left it —
#: never from rest — which is why 80 ms is enough and why params.js calls the
#: retargeting "co-articulation for free".
#:
#: What a longer hold buys is a clearer look at each shape for a human judging
#: the reel, not a shape that would otherwise be missing.
HELD_MS = 150


def coverage(wire: list[dict], clip_ms: int) -> str:
    """How much open-vowel material a track carries, not merely which letters.

    The obvious metric — the set of letters present — is the one that misled the
    first pick of lines for `call.json`: three of them "covered all nine" while
    carrying almost no open vowels at all (9 against 21 for the line that
    replaced them). The second number is the one to rank on.

    It counts *material*, not rendering. A brief C is not a failed C — see
    HELD_MS — so this is about giving a viewer a good look at the mouth, which
    is what a reel is for, and not about rescuing shapes that would otherwise
    not appear.
    """
    held: dict[str, list[int]] = {}
    for j, c in enumerate(wire):
        if c["v"] == SILENT:
            continue
        end = wire[j + 1]["t"] if j + 1 < len(wire) else clip_ms
        held.setdefault(c["v"], []).append(end - c["t"])
    letters = "".join(sorted(held))
    opens = sum(1 for v in "CDE" for d in held.get(v, []) if d >= HELD_MS)
    anyheld = sum(1 for ds in held.values() for d in ds if d >= HELD_MS)
    return f"[{letters}] held {anyheld}, open {opens}"


async def main() -> None:
    spec = json.loads((CORPUS / "lines.json").read_text())
    voices = {name: v["vql_speech"] for name, v in spec["voices"].items()}

    engine = AvatarsyncEngine(AvatarsyncPaths.locate(), workers=1)
    await engine.start()
    try:
        clips: dict[str, dict] = {}
        for voice in voices:
            table: dict[str, dict] = {}
            for line in spec["lines"]:
                parts: list[dict] = []
                cues: list[Cue] = []
                at = 0
                for sentence in line["sentences"]:
                    path = CORPUS / "audio" / voice / sentence["audio"]
                    pcm, rate, ms = read_wav(path)
                    # Per sentence, exactly as `_emit_chunk` puts it on the wire:
                    # the decode, then a closing silence at the sentence's end.
                    # Shifted whole, so the turn's track is the turn's audio.
                    spoken = normalize_cues([*await engine.audio_cues(pcm, rate), Cue(t=ms, v=SILENT)])
                    cues.extend(Cue(t=c.t + at, v=c.v, p=c.p, i=c.i) for c in spoken)
                    parts.append({
                        "audio": str(path.relative_to(REPO)),
                        "t": at,
                        "ms": ms,
                        "text": sentence["text"],
                    })
                    at += ms

                wire = cues_to_wire(normalize_cues(cues))
                voiced = [c for c in wire if c["v"] != SILENT]
                table[line["id"]] = {
                    "id": line["id"],
                    "tag": line["tag"],
                    "text": " ".join(s["text"] for s in line["sentences"]),
                    "ms": at,
                    "parts": parts,
                    "cues": wire,
                }
                got = sum(1 for c in voiced if "i" in c)
                print(
                    f"{voice:<7} {line['id']:<12} {at:>6} ms  {len(wire):>3} cues  "
                    f"i on {got}/{len(voiced)}  {coverage(wire, at)}"
                )
            clips[voice] = table
    finally:
        await engine.stop()

    OUT.write_text(json.dumps({
        "_": [
            "Generated by packages/avatar-py/scripts/make_call_clips.py — do not hand-edit.",
            "",
            "The call reel's speech, from the corpus apps/server/ ships: recorded",
            "from vql-speech itself, one omnivoice id per voice. Cues are the",
            "accurate leg over that same PCM, so they carry `i` (loudness) and the",
            "mouth is not the same size on every syllable.",
            "",
            "A clip is one turn. `parts` are its sentences at their offsets within",
            "the turn, and `cues` is the whole turn's track on that same clock.",
        ],
        "voices": voices,
        "reads": READS,
        "clips": clips,
    }, indent=1) + "\n")
    print(f"\nwrote {OUT.relative_to(REPO)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    asyncio.run(main())
