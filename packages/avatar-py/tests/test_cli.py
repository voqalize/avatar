"""`voqalize-avatar`, driven the way a shell drives it.

In process rather than through `subprocess`, because what is worth protecting
here is the entry point and its argument handling — that `main` returns 0, that
the JSON on stdout is the wire cue shape, that a bad invocation fails loudly
instead of half-running. Whether the console script is wired up is pyproject's
job and `uv run voqalize-avatar` proves it in a second.

These are sync tests on purpose: `main` owns `asyncio.run`, which is the whole
difference between a CLI and a library, and calling it from inside a running
loop would test something the CLI never does.
"""

from __future__ import annotations

import json

import pytest

from voqalize_avatar.avatarsync import AvatarsyncPaths, Cue
from voqalize_avatar.cli import format_table, main, read_audio

from .conftest import FIXTURES


@pytest.fixture(autouse=True)
def _needs_the_library() -> None:
    paths = AvatarsyncPaths.locate()
    if not paths.library.is_file():
        pytest.skip(f"no library at {paths.library}")


def test_info_reports_a_working_install(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["info"]) == 0

    out = capsys.readouterr().out
    assert "MISSING" not in out
    # The line that makes this a smoke test and not a file listing: the library
    # was asked a question and answered.
    assert "text leg" in out
    assert "shapes      A B C D E F G H X" in out


def test_cues_from_text_are_wire_shaped(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["cues", "--text", "Take your time.", "--ms", "900", "--json"]) == 0

    cues = json.loads(capsys.readouterr().out)
    assert cues
    assert all(set(cue) <= {"t", "v", "p"} for cue in cues)
    assert [cue["t"] for cue in cues] == sorted(cue["t"] for cue in cues)
    assert cues[-1]["t"] <= 900
    # `p` present exactly where there is a phone — silence has none, and a null
    # would be a key the wire format does not have.
    assert all(("p" in cue) == (cue["v"] != "X") for cue in cues)


def test_cues_from_raw_pcm_run_the_accurate_leg(capsys: pytest.CaptureFixture[str]) -> None:
    clip = FIXTURES / "take-your-time.pcm"
    assert main(["cues", str(clip), "--json"]) == 0

    cues = json.loads(capsys.readouterr().out)
    assert cues
    assert any(cue.get("p") for cue in cues)


def test_a_clip_and_text_together_is_an_error() -> None:
    # argparse exits 2 for usage errors; anything else means one of the two
    # inputs was silently ignored.
    with pytest.raises(SystemExit) as exit_info:
        main(["cues", "clip.pcm", "--text", "Take your time."])
    assert exit_info.value.code == 2


def test_a_missing_library_is_a_message_not_a_traceback(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        AvatarsyncPaths,
        "locate",
        classmethod(
            lambda cls: cls(library=tmp_path / "nope", res_dir=tmp_path, weights=None)
        ),
    )

    assert main(["cues", "--text", "Anything.", "--ms", "500"]) == 1
    err = capsys.readouterr().err
    assert str(tmp_path) in err, "the error must name the path it looked at"
    assert "Traceback" not in err


def test_stereo_input_is_refused_with_the_command_to_fix_it(tmp_path) -> None:
    import wave

    path = tmp_path / "stereo.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(b"\x00\x00" * 200)

    with pytest.raises(SystemExit, match="ffmpeg"):
        read_audio(path, 24000)


def test_the_table_shows_how_long_each_shape_is_held() -> None:
    # The last cue is held to the end of the clip, which is the one duration not
    # derivable from the cue list itself.
    table = format_table([Cue(0, "A", "M"), Cue(100, "X")], 400).splitlines()

    assert table[0].split() == ["0", "ms", "A", "M", "─" * 5, "100", "ms"]
    assert table[1].endswith("300 ms")
