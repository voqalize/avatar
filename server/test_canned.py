"""The canned services, against the frame contract they have to honour.

Everything asserted here is something the pipeline does not tell you about when
it is wrong. A service that forgets to forward a frame stalls with no error; one
that emits `TTSStartedFrame` itself gets two of them and the avatar opens its
mouth twice; a sentence with no clip plays silence while the face mouths it. All
four look like a working call until you have headphones on, which is why they
are tested rather than reviewed.

    cd server && uv run --project ../py --group server python -m pytest
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from pipecat.clocks.system_clock import SystemClock
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    StartFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import (
    FrameDirection,
    FrameProcessor,
    FrameProcessorSetup,
)
from pipecat.utils.asyncio.task_manager import TaskManager, TaskManagerParams

from canned import CannedLines, CannedLLMService, CannedTTSService

LINES = Path(__file__).parent / "lines.json"


def _task_manager() -> TaskManager:
    loop = asyncio.get_running_loop()
    try:
        return TaskManager(loop=loop)
    except TypeError:
        manager = TaskManager()
        manager.setup(TaskManagerParams(loop=loop))
        return manager


class Capture(FrameProcessor):
    """Records everything that reaches it, in order, and passes it on.

    Passing it on is not optional even for the tap at the end of the chain: a
    `Capture` that swallows frames stops the one in the middle from ever seeing
    a `StartFrame`, and a TTS that never got one has a sample rate of 0.
    """

    def __init__(self) -> None:
        super().__init__(enable_direct_mode=True)
        self.seen: list[tuple[Frame, FrameDirection]] = []

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        self.seen.append((frame, direction))
        await self.push_frame(frame, direction)

    def of(self, *types: type[Frame], direction: FrameDirection | None = None) -> list[Frame]:
        return [
            f
            for f, d in self.seen
            if isinstance(f, types) and (direction is None or d is direction)
        ]

    def names(self) -> list[str]:
        return [type(f).__name__ for f, _ in self.seen]


class Chain:
    """`up ← llm → mid → tts → out`, set up the way a pipeline sets them up.

    Three capture points because the three contracts under test are observed at
    three different places. `mid` sees what the LLM emits, before the TTS eats
    the text frames and replaces them with its own. `out` sees what the TTS
    emits. `up` sees what travels back the other way — `push_error_frame` is
    upstream-only, so a downstream-only harness would report a missing clip as
    no error at all.
    """

    def __init__(self, lines: CannedLines, *, speed: float = 0) -> None:
        self.lines = lines
        self.up = Capture()
        self.llm = CannedLLMService(lines=lines)
        self.mid = Capture()
        self.tts = CannedTTSService(lines=lines, speed=speed)
        self.out = Capture()

    @property
    def _all(self) -> tuple[FrameProcessor, ...]:
        return (self.up, self.llm, self.mid, self.tts, self.out)

    async def __aenter__(self) -> Chain:
        self.up.link(self.llm)
        self.llm.link(self.mid)
        self.mid.link(self.tts)
        self.tts.link(self.out)
        setup = FrameProcessorSetup(
            clock=SystemClock(),
            task_manager=_task_manager(),
            pipeline_worker=SimpleNamespace(app_resources=None),  # type: ignore[arg-type]
        )
        for p in self._all:
            await p.setup(setup)

        # A processor does not act on a frame inside the `process_frame` call —
        # it queues it. Returning from `push(StartFrame(...))` therefore proves
        # nothing: the TTS has not run `start()` yet, so its sample rate is still
        # 0 and it has no audio-context task. Wait for the frame to come out the
        # far end, which is the only evidence every processor has seen it.
        await self.push(StartFrame(audio_in_sample_rate=16000, audio_out_sample_rate=24000))
        await self.until(lambda: bool(self.out.of(StartFrame)))
        return self

    async def __aexit__(self, *exc: object) -> None:
        for p in self._all:
            await p.cleanup()

    async def push(self, *frames: Frame) -> None:
        """Enter at the head, not at the LLM.

        `up` is a processor like any other and refuses to handle anything before
        its own `StartFrame`; feeding the LLM directly would leave the one tap
        that matters for errors permanently unstarted.
        """
        for frame in frames:
            await self.up.process_frame(frame, FrameDirection.DOWNSTREAM)

    async def push_up(self, frame: Frame) -> None:
        """Send a frame back the way the output transport sends its own.

        `BotStartedSpeakingFrame` and `BotStoppedSpeakingFrame` originate at the
        transport and travel upstream, so a test that pushed them downstream
        would prove the service reacts to a frame it never actually receives.
        Returns once the LLM has seen it — `process_frame` queues.
        """
        await self.out.process_frame(frame, FrameDirection.UPSTREAM)
        await self.until(lambda: frame in self.up.of(type(frame)))

    async def until(self, done, timeout: float = 15.0) -> None:
        deadline = asyncio.get_running_loop().time() + timeout
        while not done():
            if asyncio.get_running_loop().time() > deadline:
                raise TimeoutError(f"gave up; downstream saw {self.out.names()}")
            await asyncio.sleep(0.01)

    async def settle(self, turns: int = 1, timeout: float = 15.0) -> None:
        """Wait for `turns` completions to finish speaking.

        One audio context spans a whole completion, however many sentences it
        aggregates into, and it closes from a background task long after `push`
        returned — so `TTSStoppedFrame` is the only honest end-of-turn signal.
        """
        await self.until(lambda: len(self.out.of(TTSStoppedFrame)) >= turns, timeout)


@pytest.fixture
def lines() -> CannedLines:
    return CannedLines.load(LINES)


# --- the corpus -------------------------------------------------------------


def test_every_sentence_has_a_clip(lines: CannedLines) -> None:
    """`CannedLines.load` validates on the way in, so this is really asserting
    that the shipped corpus passes its own gate — the case that matters, since
    an unrecorded sentence is silence the face still mouths."""
    for line in lines.lines:
        for sentence in line.sentences:
            assert sentence.audio.exists(), f"{line.id}: {sentence.audio}"
            assert sentence.ms > 0
            assert lines.find(sentence.text) is sentence


def test_lookup_survives_what_the_aggregator_does(lines: CannedLines) -> None:
    """Pipecat hands `run_tts` text that has been through filters, transforms
    and an optional trailing space. A clip missed over whitespace would read as
    a missing recording."""
    first = lines.lines[0].sentences[0]
    for mangled in (first.text, f"  {first.text} ", first.text.upper(), first.text.lower()):
        assert lines.find(mangled) is first


def test_rejects_a_clip_that_is_not_what_the_corpus_declares(
    tmp_path: Path, lines: CannedLines
) -> None:
    """A 44.1 kHz clip in a 22.05 kHz corpus plays at half speed through the
    resampler and sounds like a different person, with no error anywhere."""
    import json
    import wave

    src = lines.lines[0].sentences[0]
    bad = tmp_path / "audio" / "bad.wav"
    bad.parent.mkdir()
    with wave.open(str(src.audio)) as r, wave.open(str(bad), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)  # the lie
        w.writeframes(r.readframes(r.getnframes()))

    manifest = tmp_path / "lines.json"
    manifest.write_text(
        json.dumps(
            {
                "sample_rate": lines.sample_rate,
                "lines": [
                    {"id": "x", "tag": "t", "sentences": [{"text": "hi", "audio": "audio/bad.wav"}]}
                ],
            }
        )
    )
    with pytest.raises(ValueError, match="44100"):
        CannedLines.load(manifest)


# --- the LLM ----------------------------------------------------------------


async def test_a_user_turn_produces_one_completion(lines: CannedLines) -> None:
    """The shape a vendor LLM emits, observed before the TTS consumes it.

    The end frame is the load-bearing one: `TTSService` flushes its sentence
    aggregator on it, so without it the last sentence is synthesised late or
    never."""
    first = lines.lines[0]
    async with Chain(lines) as chain:
        await chain.push(UserStoppedSpeakingFrame())
        await chain.until(lambda: bool(chain.mid.of(LLMFullResponseEndFrame)))

        assert len(chain.mid.of(LLMFullResponseStartFrame)) == 1
        assert len(chain.mid.of(LLMFullResponseEndFrame)) == 1
        spoken = [f.text for f in chain.mid.of(LLMTextFrame)]
        assert [t.strip() for t in spoken] == [s.text for s in first.sentences]
        # The separators the aggregator needs to see a sentence boundary at all.
        assert all(t.endswith(" ") for t in spoken), spoken


async def test_the_trigger_frame_is_still_forwarded(lines: CannedLines) -> None:
    """`LLMService.process_frame` does not forward anything — not the base, not
    `AIService`, not `FrameProcessor`. A subclass that consumes its trigger
    instead of passing it on stalls every processor downstream, silently."""
    async with Chain(lines) as chain:
        await chain.push(UserStoppedSpeakingFrame())
        await chain.until(lambda: bool(chain.mid.of(UserStoppedSpeakingFrame)))


async def test_turns_advance_through_the_corpus(lines: CannedLines) -> None:
    async with Chain(lines) as chain:
        said = [(await chain.llm.say_next()).id for _ in range(3)]
        assert said == [line.id for line in lines.lines[:3]]


async def test_it_will_not_talk_over_itself(lines: CannedLines) -> None:
    """A pause mid-sentence ends a VAD turn. Without this guard the second line
    queues behind the first and the avatar never stops."""
    async with Chain(lines) as chain:
        await chain.push_up(BotStartedSpeakingFrame())
        assert await chain.llm.say_next() is None

        await chain.push_up(BotStoppedSpeakingFrame())
        assert await chain.llm.say_next() is not None


# --- the TTS ----------------------------------------------------------------


async def test_the_base_class_emits_the_speaking_frames_exactly_once(
    lines: CannedLines,
) -> None:
    """`run_tts` yields only audio. The avatar's speaking state is driven by
    these two frames, so a duplicate opens the mouth twice and a missing one
    never opens it at all — with the audio playing either way."""
    async with Chain(lines) as chain:
        await chain.push(UserStoppedSpeakingFrame())
        await chain.settle()

        assert len(chain.out.of(TTSStartedFrame)) == 1, chain.out.names()
        assert len(chain.out.of(TTSStoppedFrame)) == 1, chain.out.names()


async def test_it_plays_the_whole_clip(lines: CannedLines) -> None:
    first = lines.lines[0]
    async with Chain(lines) as chain:
        await chain.push(UserStoppedSpeakingFrame())
        await chain.settle()

        audio = chain.out.of(TTSAudioRawFrame)
        assert audio, chain.out.names()
        for frame in audio:
            assert frame.sample_rate == lines.sample_rate
            assert frame.num_channels == 1

        played = sum(len(f.audio) for f in audio) / (lines.sample_rate * 2) * 1000
        assert played == pytest.approx(sum(s.ms for s in first.sentences), abs=1.0)


async def test_a_sentence_nobody_recorded_is_loud(lines: CannedLines) -> None:
    """The corpus is closed. A miss is a corpus bug, and the alternative to an
    error is a face mouthing silence.

    Caught upstream, because that is where `push_error_frame` sends it — the
    pipeline task is up there, not the transport."""
    async with Chain(lines) as chain:
        await chain.push(
            LLMFullResponseStartFrame(),
            LLMTextFrame("This sentence was never recorded."),
            LLMFullResponseEndFrame(),
        )
        await chain.until(
            lambda: bool(chain.up.of(ErrorFrame, direction=FrameDirection.UPSTREAM))
        )


async def test_pacing_hands_audio_over_gradually(lines: CannedLines) -> None:
    """Dumping a whole utterance in one tick would give the aligner the entire
    waveform before the first sample is audible, so the accurate leg would win
    every race it is supposed to sometimes lose."""
    first = lines.lines[0]
    spoken_ms = sum(s.ms for s in first.sentences)

    async with Chain(lines, speed=8.0) as chain:
        start = asyncio.get_running_loop().time()
        await chain.push(UserStoppedSpeakingFrame())
        await chain.settle()
        elapsed = asyncio.get_running_loop().time() - start

    assert elapsed > spoken_ms / 8000 * 0.5, "audio arrived instantly — no pacing"
    assert elapsed < spoken_ms / 1000, "audio arrived no faster than real time"
