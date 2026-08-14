"""`voqalize-avatar` — the aligner, by hand.

There is no native command-line program. The only artifact `native/avatarsync`
builds is the shared library, and this is what you run instead: same library,
same two legs, same code path a live pipeline takes. That is the point of it
being Python rather than a second C++ front end — a binary built beside the
library is a binary that can disagree with it, and every timing number in the
README would then be a number about the wrong thing.

    voqalize-avatar info                        # is lipsync working, and how fast
    voqalize-avatar cues --text "Take your time." --ms 900
    voqalize-avatar cues clip.wav               # real recognition
    voqalize-avatar cues clip.wav --json | jq   # the wire form

Data goes to stdout and commentary to stderr, so the JSON pipes cleanly.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import wave
from pathlib import Path

from .avatarsync import AvatarsyncEngine, AvatarsyncError, AvatarsyncPaths, Cue, platform_id
from .durations import estimate_duration_ms

# The CLI decodes one clip at a time, so one worker and one warm decoder. Opening
# still pays the acoustic model even for a text-only run — ~150 ms, and not worth
# a warm-up knob on `AvatarsyncEngine` that exists only for this file.
WORKERS = 1


def read_audio(path: Path, rate: int) -> tuple[bytes, int]:
    """`(pcm, sample_rate)` from a wav, or from raw s16le at `rate`.

    Only 16-bit mono, and deliberately no conversion: a CLI that silently
    downmixes is a CLI that answers a question you did not ask. `ffmpeg -i in.mp3
    -ac 1 -ar 24000 -c:a pcm_s16le out.wav` is the one line you need.
    """
    if path.suffix.lower() != ".wav":
        return path.read_bytes(), rate

    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
            raise SystemExit(
                f"{path} is {wav.getnchannels()}-channel {wav.getsampwidth() * 8}-bit; "
                "this reads 16-bit mono only.\n"
                f"  ffmpeg -i {path} -ac 1 -ar 24000 -c:a pcm_s16le mono.wav"
            )
        return wav.readframes(wav.getnframes()), wav.getframerate()


def format_table(cues: list[Cue], total_ms: int) -> str:
    """One line per cue, with a bar for how long it is held.

    The bar is there because this subsystem is judged by eye — a track that
    reads fine as a list of letters can still be a mouth that holds one shape
    for half a second and then flutters, and the shape of that is visible here
    and nowhere in the JSON.
    """
    lines = []
    for index, cue in enumerate(cues):
        end = cues[index + 1].t if index + 1 < len(cues) else total_ms
        held = max(0, end - cue.t)
        bar = "─" * min(60, held // 20)
        lines.append(f"{cue.t:>7} ms  {cue.v}  {cue.p or '':<6} {bar} {held} ms")
    return "\n".join(lines)


async def cmd_cues(args: argparse.Namespace) -> int:
    paths = AvatarsyncPaths.locate()
    engine = AvatarsyncEngine(paths, workers=WORKERS)
    await engine.start()
    try:
        if args.text is not None:
            total_ms = args.ms or estimate_duration_ms(args.text)
            started = time.perf_counter()
            cues = await engine.text_cues(args.text, total_ms)
            leg = "text"
        else:
            pcm, rate = read_audio(args.clip, args.rate)
            total_ms = round(len(pcm) / 2 / rate * 1000)
            started = time.perf_counter()
            cues = await engine.audio_cues(pcm, rate)
            leg = "audio"
        elapsed_ms = (time.perf_counter() - started) * 1000
    finally:
        await engine.stop()

    if args.json:
        print(json.dumps([_wire(cue) for cue in cues]))
    else:
        print(format_table(cues, total_ms))
    print(
        f"{leg} leg: {len(cues)} cues over {total_ms} ms in {elapsed_ms:.2f} ms",
        file=sys.stderr,
    )
    return 0


def _wire(cue: Cue) -> dict[str, object]:
    """The wire cue, phone included when there is one. Mirrors
    `visemes.cues_to_wire` — see docs/contract-protocol.md § Speech."""
    return {"t": cue.t, "v": cue.v} if cue.p is None else {"t": cue.t, "v": cue.v, "p": cue.p}


async def cmd_info(args: argparse.Namespace) -> int:
    """Where the library is, what it loaded, and proof that it answers.

    This is also the wheel smoke test in CI: a wheel that installs, imports and
    then cannot produce a cue is the failure worth catching before publishing,
    and it is not visible from the file listing.
    """
    paths = AvatarsyncPaths.locate()
    print(f"platform    {platform_id()}")
    print(f"library     {paths.library}{'' if paths.library.is_file() else '   MISSING'}")
    print(f"res         {paths.res_dir}{'' if paths.res_dir.is_dir() else '   MISSING'}")
    weights = paths.weights
    found = weights is not None and weights.is_file()
    print(f"weights     {weights or '(none)'}{'' if found else '   MISSING — using the prior'}")

    started = time.perf_counter()
    engine = AvatarsyncEngine(paths, workers=WORKERS)
    await engine.start()
    try:
        native = engine._engine  # noqa: SLF001 - this command is the diagnostic
        if native is None:  # pragma: no cover - start() raises rather than lie
            raise AvatarsyncError("the engine started but holds no library")
        print(f"open        {(time.perf_counter() - started) * 1000:.0f} ms")
        print(f"  dict      {native.dict_entries} entries in {native.load_ms:.0f} ms")
        print(f"  warm-up   {native.warmup_ms:.0f} ms ({WORKERS} decoder)")
        # The memory bound, in the one place it can be seen. Concurrency is
        # capped twice — `workers` decides how many decodes run at once, and
        # `max_streams` is the library's own ceiling on live decoders, each of
        # them ~55 MB. A pipeline that exceeds it does not queue, it is refused
        # and the turn latches to the text leg, so the number is worth printing
        # next to a deployment rather than reading out of C++.
        print(f"  streams   {native.max_streams} live decoders at once")
        print(f"shapes      {' '.join(native.shape_names)}")
        print(f"phones      {' '.join(native.phone_names)}")

        text = "Hello there."
        started = time.perf_counter()
        cues = await engine.text_cues(text, 1200)
        print(
            f"text leg    {len(cues)} cues in {(time.perf_counter() - started) * 1000:.2f} ms"
            f"  {''.join(cue.v for cue in cues)}"
        )
    finally:
        await engine.stop()
    return 0 if cues else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="voqalize-avatar",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    info = sub.add_parser("info", help="where the aligner is, and whether it answers")
    info.set_defaults(run=cmd_info)

    cues = sub.add_parser("cues", help="mouth shapes for a clip (accurate) or text (fast)")
    cues.add_argument("clip", nargs="?", type=Path, help="16-bit mono .wav, or raw s16le")
    cues.add_argument("--text", help="run the fast leg on this text instead of a clip")
    cues.add_argument(
        "--ms",
        type=int,
        help="duration the text is stretched to; defaults to the estimator's guess",
    )
    cues.add_argument(
        "--rate", type=int, default=24000, help="sample rate for raw input (default 24000)"
    )
    cues.add_argument("--json", action="store_true", help="wire cues on stdout, for piping")
    cues.set_defaults(run=cmd_cues)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "cues" and (args.clip is None) == (args.text is None):
        parser.error("give a clip or --text, not both")
    try:
        return asyncio.run(args.run(args))
    except AvatarsyncError as exc:
        # The one error every entry point here can raise, and it always names a
        # path or a message from the library. No traceback: it is a condition,
        # not a bug in this file.
        print(f"voqalize-avatar: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
