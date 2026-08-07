"""The one place the state channel and the viseme stack are introduced.

Two shapes have to be reconciled here and nowhere else — `push_cues` is
keyword-only with wire dicts, `emit` is positional with `Cue` objects — and the
degradation path runs through here too. Both are the kind of thing that is
obviously right when written and silently wrong six months later, so they get
tests that do not need the native binary.
"""

from __future__ import annotations

import asyncio

import pytest

from voqalize_avatar.avatarsync import Cue, RhubarbPaths
from voqalize_avatar.wiring import _voice_of, attach_tts_hooks, build_viseme_engine
from tests.helpers import AvatarPipe

pytestmark = pytest.mark.asyncio


class FakeRuntime:
    """A rhubarb that answers instantly and never spawns anything.

    `build_viseme_engine` takes an injected runtime precisely so the wiring can
    be tested on a machine with no binary — which is most CI machines.
    """

    def __init__(self) -> None:
        self.stopped = False
        self.starts = 0

    async def start(self) -> None:
        self.starts += 1

    async def text_cues(self, text: str, duration_ms: int) -> list[Cue]:
        return [Cue(t=0, v="B"), Cue(t=max(1, duration_ms // 2), v="E")]

    async def audio_cues(self, pcm: bytes, sample_rate: int) -> list[Cue]:
        return [Cue(t=0, v="C")]

    async def stop(self) -> None:
        self.stopped = True


class SlowStartRuntime(FakeRuntime):
    """A rhubarb whose spawn takes long enough to lose a race to.

    The real one takes ~250 ms (an 82 MB acoustic model plus a decoder warmup),
    which is the entire reason `prewarm()` exists.
    """

    async def start(self) -> None:
        await asyncio.sleep(0.05)
        self.starts += 1


class FakeTTS:
    """Just enough of the mixin's listener surface, plus a settings store."""

    class _Settings:
        voice = "reference/a"
        language = "en"

    def __init__(self) -> None:
        self._settings = self._Settings()
        self.queued_listener = None
        self.boundary_listener = None

    def set_sentence_queued_listener(self, listener) -> None:
        self.queued_listener = listener

    def set_sentence_boundary_listener(self, listener) -> None:
        self.boundary_listener = listener


async def test_cues_reach_the_wire_in_the_widget_s_shape() -> None:
    """`Cue` objects on one side, `{t, v}` dicts on the other. The adapter is
    the only translation, and it is here."""
    async with AvatarPipe() as pipe:
        engine = build_viseme_engine(pipe.avatar, sample_rate=24000, runtime=FakeRuntime())
        assert engine is not None
        pipe.drain()
        await engine.on_sentence_queued("1.1", "Take your time.", "reference/a")
        await engine.flush("1.1")
        cues = [m for m in pipe.wire if m["cmd"] == "cues"]
        assert cues
        assert cues[0]["ctx"] == "1.1"
        assert all(set(c) == {"t", "v"} for c in cues[0]["cues"])
        await engine.aclose()


async def test_the_engine_is_installed_as_the_processor_s_audio_sink() -> None:
    async with AvatarPipe() as pipe:
        engine = build_viseme_engine(pipe.avatar, sample_rate=24000, runtime=FakeRuntime())
        assert pipe.avatar.audio_sink is engine
        await engine.aclose()  # type: ignore[union-attr]


async def test_the_runtime_is_pre_warmed_without_waiting_for_a_sentence() -> None:
    """`avatarsync` costs ~250 ms to spawn. Left lazy it spawns on the call's
    first sentence — inside the window the fast leg exists to cover."""
    async with AvatarPipe() as pipe:
        runtime = SlowStartRuntime()
        engine = build_viseme_engine(pipe.avatar, sample_rate=24000, runtime=runtime)
        assert engine is not None
        # Building did not block on the spawn...
        assert runtime.starts == 0
        # ...but the spawn is already in flight, with nothing queued.
        await engine.prewarm()
        assert runtime.starts == 1
        await engine.aclose()


async def test_a_sentence_that_beats_the_warmup_still_gets_cues() -> None:
    """The pre-warm must not become a new way to lose the first sentence: a
    request that arrives mid-spawn waits for the process, it does not fail."""
    async with AvatarPipe() as pipe:
        runtime = SlowStartRuntime()
        engine = build_viseme_engine(pipe.avatar, sample_rate=24000, runtime=runtime)
        assert engine is not None
        pipe.drain()

        await engine.on_sentence_queued("1.1", "Take your time.", "reference/a")
        await engine.flush("1.1")

        assert [m for m in pipe.wire if m["cmd"] == "cues"]
        await engine.prewarm()
        assert runtime.starts == 1
        await engine.aclose()


async def test_a_runtime_that_cannot_pre_warm_is_not_fatal() -> None:
    """A failed spawn is exactly as survivable as any other rhubarb failure —
    the first sentence retries it, and the widget's own fallback covers a turn
    with no cues. It must not take the session down."""

    class Unspawnable(FakeRuntime):
        async def start(self) -> None:
            raise RuntimeError("no binary here")

    async with AvatarPipe() as pipe:
        engine = build_viseme_engine(pipe.avatar, sample_rate=24000, runtime=Unspawnable())
        assert engine is not None
        await engine.prewarm()
        pipe.drain()
        await engine.on_sentence_queued("1.1", "Take your time.", "reference/a")
        await engine.flush("1.1")
        assert [m for m in pipe.wire if m["cmd"] == "cues"]
        await engine.aclose()


async def test_the_flag_turns_the_whole_thing_off() -> None:
    async with AvatarPipe() as pipe:
        assert build_viseme_engine(pipe.avatar, enabled=False, sample_rate=24000) is None
        assert pipe.avatar.audio_sink is None


async def test_a_missing_binary_degrades_instead_of_raising(tmp_path) -> None:
    """Building per-platform means some platform will not have one. The session
    still has to run — the widget falls back to its own amplitude lipsync.

    Note there is no `monkeypatch` here. The path is an argument, so pointing a
    test at a home that does not exist is a value, not a mutation of the
    process's environment that every other test then has to be isolated from.
    """
    async with AvatarPipe() as pipe:
        assert build_viseme_engine(pipe.avatar, sample_rate=24000, avatarsync=tmp_path) is None
        assert pipe.avatar.audio_sink is None


async def test_omitting_the_path_uses_whatever_the_wheel_shipped() -> None:
    """The headline promise: `pip install` and lipsync works, no configuration.

    This asserts against `bundled()` rather than a fixed answer because both
    answers are correct and which one you get is a property of the install, not
    of the code. A platform wheel carries the aligner and the engine builds; an
    sdist install, or a platform we publish no wheel for, carries none and the
    session runs the state channel alone. The bug this catches is either half
    disagreeing with `RhubarbPaths.bundled()` — an engine when there is no
    binary, or no engine when there is one.
    """
    from voqalize_avatar.avatarsync import RhubarbPaths

    bundled = RhubarbPaths.bundled()
    async with AvatarPipe() as pipe:
        engine = build_viseme_engine(pipe.avatar, sample_rate=24000)
        if bundled is None:
            assert engine is None
            assert pipe.avatar.audio_sink is None
        else:
            assert engine is not None
            await engine.aclose()


async def test_the_off_switch_is_a_flag_not_an_omission() -> None:
    """`enabled=False` says "not on this node". Omitting the path does not —
    it says "use the one you shipped with", which is the whole point."""
    async with AvatarPipe() as pipe:
        assert build_viseme_engine(pipe.avatar, enabled=False, sample_rate=24000) is None
        assert pipe.avatar.audio_sink is None


async def test_the_bundle_is_addressed_relative_to_the_package() -> None:
    """Wherever the wheel unpacked to. An absolute path baked at build time, or
    one resolved against the working directory, would work in the checkout that
    produced it and nowhere else."""
    from pathlib import Path

    import voqalize_avatar
    from voqalize_avatar.avatarsync import _BUNDLE_DIR

    assert _BUNDLE_DIR == Path(voqalize_avatar.__file__).resolve().parent / "_native"

    bundled = RhubarbPaths.bundled()
    if bundled is not None:
        # One binary, no `bin/<platform>/` level: the wheel tag already says
        # which platform this is.
        assert bundled.binary == _BUNDLE_DIR / "avatarsync"
        assert bundled.res_dir == _BUNDLE_DIR / "res"


async def test_a_home_directory_is_accepted_as_a_path_or_a_string(tmp_path) -> None:
    """`from_home` is the common case, so the argument takes the bare directory.

    `RhubarbPaths` stays available for a layout that is not that shape — the
    convenience does not become the only way in.
    """
    from voqalize_avatar.avatarsync import RhubarbPaths, platform_id

    paths = RhubarbPaths.from_home(tmp_path)
    assert paths.binary == tmp_path / "bin" / platform_id() / "avatarsync"
    assert paths.res_dir == tmp_path / "res"
    assert paths.weights == tmp_path / "data" / "phone_weights.json"

    async with AvatarPipe() as pipe:
        assert build_viseme_engine(pipe.avatar, sample_rate=24000, avatarsync=str(tmp_path)) is None
        assert build_viseme_engine(pipe.avatar, sample_rate=24000, avatarsync=paths) is None


async def test_closing_the_engine_stops_the_runtime() -> None:
    async with AvatarPipe() as pipe:
        runtime = FakeRuntime()
        engine = build_viseme_engine(pipe.avatar, sample_rate=24000, runtime=runtime)
        await engine.aclose()  # type: ignore[union-attr]
        assert runtime.stopped


# ─── The hooks ────────────────────────────────────────────────────────────────


async def test_a_queued_sentence_drives_both_the_claim_and_the_fast_leg() -> None:
    async with AvatarPipe() as pipe:
        engine = build_viseme_engine(pipe.avatar, sample_rate=24000, runtime=FakeRuntime())
        tts = FakeTTS()
        attach_tts_hooks(tts, pipe.avatar, engine)
        pipe.drain()

        await tts.queued_listener("1.1", "Take your time.")  # type: ignore[misc]
        await engine.flush("1.1")  # type: ignore[union-attr]

        sent = [m["cmd"] for m in pipe.wire]
        assert sent[:2] == ["state", "interject"]
        assert "cues" in sent
        await engine.aclose()  # type: ignore[union-attr]


async def test_the_claim_is_wired_even_with_no_engine() -> None:
    """The floor claim is the half with a deadline. A node with no binary still
    has to breathe in before it speaks."""
    async with AvatarPipe() as pipe:
        tts = FakeTTS()
        attach_tts_hooks(tts, pipe.avatar, None)
        pipe.drain()
        await tts.queued_listener("1.1", "Take your time.")  # type: ignore[misc]
        assert pipe.drain() == ["state:TAKING_FLOOR", "interject:CLAIM_FLOOR"]
        assert tts.boundary_listener is None


async def test_the_voice_is_read_per_sentence_not_once() -> None:
    """A brain can change the voice mid-call and the duration estimate is
    voice-specific."""
    tts = FakeTTS()
    assert _voice_of(tts) == ("reference/a", "en")
    tts._settings.voice = "reference/b"  # type: ignore[misc]
    assert _voice_of(tts) == ("reference/b", "en")


async def test_an_unreadable_settings_store_falls_back_rather_than_raising() -> None:
    """pipecat's `_settings` is private. If its shape changes, the fast leg
    should lose accuracy, not raise on every sentence of every call."""
    assert _voice_of(object()) == (None, "en")
