"""Regenerate `demo/lipsync-clips.json` — the review page's data.

Ten clips, both legs, produced by the **shipping** code path: the same
`AvatarsyncEngine` a pipecat call loads, then the same `lead_track` /
`normalize_cues` that `VisemeEngine._run_fast_leg` and `_run_accurate_leg` apply
before anything reaches the wire. A page fed by a bespoke pipeline would show
the pipeline, not the product.

What it cannot show is the *streaming* accurate leg. Production feeds a
`NativeStream` frame by frame and rewrites the tail as recognition advances;
this bakes one decode of the whole clip, which is the same decoder over the same
bytes but with no rewrites in it. So the page is an honest picture of what each
leg's cues look like and a poor one of how they interleave — for that, watch a
real call.

    cd py && uv run python scripts/make_lipsync_clips.py

The two tracks are not two qualities of the same thing — they are what the
avatar renders at two different moments of one sentence, so the page can A/B
them against the same audio:

  text   the fast leg, ~0.2 ms. Timed off `estimate_duration_ms(text)`, not off
         the clip, because that is all it has when it runs — the audio does not
         exist yet. Led by FAST_LEAD_MS. Its drift against the real duration is
         the artefact worth looking at, so do not "fix" it by passing the true
         length in.
  audio  the accurate leg, ~21 ms/s of audio. Real recognition over the PCM.
  fit    the fast leg given the clip's *true* duration. Not something production
         can ever have — it exists to separate the two ways the fast leg can be
         wrong. If `fit` reads well and `text` does not, the predicted phone
         timeline is fine and the duration table is what needs refitting for
         these voices; if `fit` reads badly too, the timeline itself is at fault.

The accurate leg is additionally baked at every `REST_THRESHOLDS` value into
`rest`, so the page can A/B how long a silence has to be before the mouth
closes. `0` is Rhubarb's own behaviour and is the honest control: it holds an
open vowel through anything shorter than 350 ms, which is most conversational
commas. This number is set by eye — the trade is a threshold low enough to close
on a comma against one high enough not to snap shut inside a stop consonant —
and only the winner ships as `Config::pauseRestMs`.

Audio and text come from `demo/eval-clips.json`, whose `tracks` were baked by
the old subprocess pipeline and are left alone; this writes a separate file.
"""

from __future__ import annotations

import asyncio
import json
import wave
from pathlib import Path

from voqalize_avatar.avatarsync import AvatarsyncEngine, AvatarsyncPaths, Cue
from voqalize_avatar.durations import estimate_duration_ms
from voqalize_avatar.visemes import SILENT, cues_to_wire, lead_track, normalize_cues

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / "demo"
OUT = DEMO / "lipsync-clips.json"

# Ten, chosen to span what a call actually contains rather than to flatter the
# aligner. Backchannels are over-represented on purpose: the avatar listens far
# more than it speaks, and an interjection is where a wrong mouth is most
# visible because there is so little else on screen.
PICKS: list[tuple[str, str]] = [
    ("ev_00", "the shortest thing it will ever say — 0.6 s, one syllable"),
    ("ev_02", "'Sure' — the F/pucker shape, easy to under-render"),
    ("ev_06", "'No problem' — two closures; if A does not land on p/b, you see it"),
    ("ev_09", "a four-word backchannel, the most common thing in a call"),
    ("ev_10", "shortest full sentence, where the fast leg is at its best"),
    ("ev_08", "spelled letters — no lexical rhythm to hide behind"),
    ("ev_15", "digits — same, and the shape sequence is checkable by ear"),
    ("ev_14", "3 s of ordinary prose, the median case"),
    ("ev_19", "4.4 s — long enough for fast-leg duration error to show"),
    ("ev_22", "8 s question, the worst case for a predicted timeline"),
]

# Pause-rest thresholds to bake, in ms. 0 means "leave it to Rhubarb" and is the
# A/B control. The rest bracket where the answer plausibly lies: 120 will also
# close on a long stop closure, 250 leaves a short comma open. The first entry
# that equals the library default is what `tracks.audio` shows.
REST_THRESHOLDS = [0, 120, 150, 200, 250]
DEFAULT_REST = 150


def read_wav(path: Path) -> tuple[bytes, int, int]:
    """`(pcm, sample_rate, ms)` for a 16-bit mono wav."""
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
            raise SystemExit(f"{path} is not 16-bit mono")
        frames = wav.getnframes()
        rate = wav.getframerate()
        return wav.readframes(frames), rate, round(frames / rate * 1000)


def fast_track(text: str, est_ms: int, cues: list[Cue]) -> list[Cue]:
    """What `_emit_sentence` puts on the wire for a turn's first sentence."""
    return normalize_cues(lead_track([*cues, Cue(t=est_ms, v=SILENT)]))


def accurate_track(cues: list[Cue], clip_ms: int) -> list[Cue]:
    """What `_emit_chunk` puts on the wire once that sentence's audio lands."""
    return normalize_cues([*cues, Cue(t=clip_ms, v=SILENT)])


async def main() -> None:
    source = {c["id"]: c for c in json.loads((DEMO / "eval-clips.json").read_text())}
    paths = AvatarsyncPaths.locate()
    # One engine per threshold. The threshold is baked at open() rather than per
    # call on purpose — production sets it once and a per-call knob would be a
    # knob the library does not need — so an A/B costs an engine, which is
    # ~100 ms and only happens here.
    engines = {t: AvatarsyncEngine(paths, workers=1, pause_rest_ms=t) for t in REST_THRESHOLDS}
    engine = engines[DEFAULT_REST]
    for e in engines.values():
        await e.start()
    try:
        out = []
        for clip_id, why in PICKS:
            meta = source[clip_id]
            path = DEMO / meta["audio"]
            pcm, rate, clip_ms = read_wav(path)
            est_ms = estimate_duration_ms(meta["text"])

            rest = {
                str(t): accurate_track(await e.audio_cues(pcm, rate), clip_ms)
                for t, e in engines.items()
            }
            audio_cues = rest[str(DEFAULT_REST)]
            text_cues = fast_track(
                meta["text"], est_ms, await engine.text_cues(meta["text"], est_ms)
            )
            fit_cues = fast_track(
                meta["text"], clip_ms, await engine.text_cues(meta["text"], clip_ms)
            )

            out.append(
                {
                    "id": clip_id,
                    "text": meta["text"],
                    "kind": meta["kind"],
                    "voice": meta["voice"],
                    "why": why,
                    "audio": meta["audio"],
                    "ms": clip_ms,
                    # The estimator's guess, kept so the page can show how far
                    # off the fast leg was before the audio corrected it.
                    "est_ms": est_ms,
                    "tracks": {
                        "audio": cues_to_wire(audio_cues),
                        "text": cues_to_wire(text_cues),
                        "fit": cues_to_wire(fit_cues),
                    },
                    # The accurate leg at each candidate rest threshold. Keyed by
                    # ms as a string because this is JSON; `tracks.audio` is the
                    # DEFAULT_REST entry and is duplicated rather than aliased so
                    # a consumer reading only `tracks` is unaffected.
                    "rest": {k: cues_to_wire(v) for k, v in rest.items()},
                }
            )
            drift = (est_ms - clip_ms) / clip_ms * 100
            print(
                f"{clip_id}  {clip_ms:>6} ms  audio {len(audio_cues):>3} cues  "
                f"text {len(text_cues):>3} cues  est {drift:+5.1f}%  {meta['text'][:44]}"
            )
    finally:
        for e in engines.values():
            await e.stop()

    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"\nwrote {OUT.relative_to(REPO)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    asyncio.run(main())
