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
    AggregatedTextProgressFrame,
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    Frame,
    FunctionCallCancelFrame,
    FunctionCallInProgressFrame,
    InterruptionFrame,
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

from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame
from voqalize_avatar import AvatarControlFrame, AvatarProcessor

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
    """`up ← llm → mid → tts → [avatar] → out`, set up the way a pipeline does.

    Three capture points because the three contracts under test are observed at
    three different places. `mid` sees what the LLM emits, before the TTS eats
    the text frames and replaces them with its own. `out` sees what the TTS
    emits. `up` sees what travels back the other way — `push_error_frame` is
    upstream-only, so a downstream-only harness would report a missing clip as
    no error at all.

    `avatar=True` seats a real `AvatarProcessor` where `bot.py` seats it, and
    `out` then also captures the wire. Off by default: most of what is tested
    here is the canned services' own frame contract, and an extra processor in
    the chain is another thing that could be why a test failed.
    """

    def __init__(
        self,
        lines: CannedLines,
        *,
        speed: float = 0,
        avatar: bool = False,
        think_ms: int = 0,
        work_ms: int = 0,
        word_timings: bool = False,
    ) -> None:
        self.lines = lines
        self.up = Capture()
        self.llm = CannedLLMService(lines=lines)
        # Off unless a test asks, so every test that predates the pre-speech
        # beats still measures a turn that starts the instant it is triggered.
        self.llm.think_ms = think_ms
        self.llm.work_ms = work_ms
        self.mid = Capture()
        # Off unless a test asks, which is the opposite of the service's own
        # default. The whole-sentence path is the one with no second signal to
        # fall back on, so it is the one every test that is not about word
        # timings should be measuring.
        self.tts = CannedTTSService(lines=lines, speed=speed, word_timings=word_timings)
        self.avatar = AvatarProcessor() if avatar else None
        self.out = Capture()

    @property
    def _all(self) -> tuple[FrameProcessor, ...]:
        seats = (self.up, self.llm, self.mid, self.tts, self.avatar, self.out)
        return tuple(p for p in seats if p is not None)

    async def __aenter__(self) -> Chain:
        for a, b in zip(self._all, self._all[1:]):
            a.link(b)
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


@pytest.fixture(params=["female", "male"])
def lines(request: pytest.FixtureRequest) -> CannedLines:
    """Every corpus test runs against every voice.

    A voice is a directory of recordings, and the failure a second voice
    introduces is a sentence recorded for one and not the other — silence the
    face still mouths, on one setting only. Parametrising the fixture is what
    makes that a test failure rather than something you find in a call.
    """
    return CannedLines.load(LINES, request.param)


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


def test_a_voice_is_one_row_and_one_id() -> None:
    """Picking a voice has to move the recordings *and* the vendor id together.

    The defect this guards is inaudible in the default pipeline and obvious in
    production: the canned path plays the female recordings while
    `--tts vql-speech` asks for the male omnivoice id, because the two were
    threaded through separately. The avatar is drawn as a person; a voice that
    disagrees with the drawing is noticed before anything about the face is.

    Since the recordings are now vql-speech's own output, one id covers both
    paths and this is a narrower claim than it was — the id that named the
    stand-in is gone, and with it the way the two could differ.
    """
    female = CannedLines.load(LINES, "female")
    male = CannedLines.load(LINES, "male")

    assert female.voice.name == "female"
    assert female.voice.vql_speech == "omnivoice/gauri"
    assert male.voice.vql_speech == "omnivoice/gaurav"

    # Same text, different audio: one corpus, recorded twice.
    assert [n.text for n in female.lines] == [n.text for n in male.lines]
    assert female.lines[0].sentences[0].audio != male.lines[0].sentences[0].audio

    with pytest.raises(ValueError, match="no voice"):
        CannedLines.load(LINES, "nobody")


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
    bad = tmp_path / "audio" / "wren" / "bad.wav"
    bad.parent.mkdir(parents=True)
    with wave.open(str(src.audio)) as r, wave.open(str(bad), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)  # the lie
        w.writeframes(r.readframes(r.getnframes()))
    # A corpus is audio *and* timings, so the fake one needs both to get as far
    # as the check under test.
    (bad.parent / "timings.json").write_text(
        json.dumps({"sentences": {"bad.wav": {"ms": src.ms, "words": ["hi"], "start_ms": [0.0]}}})
    )

    manifest = tmp_path / "lines.json"
    manifest.write_text(
        json.dumps(
            {
                "sample_rate": lines.sample_rate,
                "default_voice": "wren",
                "voices": {
                    "wren": {"label": "Wren", "vql_speech": "omnivoice/x"}
                },
                "lines": [
                    {"id": "x", "tag": "t", "sentences": [{"text": "hi", "audio": "bad.wav"}]}
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


async def test_the_beats_are_inferred_rather_than_announced(lines: CannedLines) -> None:
    """`THINKING`, then `WORKING`, and nobody claimed either one.

    The point of the whole test is the seat it reads from. This server used to
    push the two states as `AvatarControlFrame` claims, so what it proved was
    that a claim travels — which was never in doubt. Reading the avatar's own
    output instead measures the path a real deployment takes: an ordinary LLM
    response frame and an ordinary tool call, inferred into the same two states
    by a processor nothing told.

    Order is the rest of the assertion. A claim is durable, so one that lands
    after the sentence it belonged to leaves the face in it.
    """
    async with Chain(lines, avatar=True, think_ms=40, work_ms=40) as chain:
        await chain.push(UserStoppedSpeakingFrame())
        await chain.until(lambda: bool(chain.mid.of(LLMFullResponseEndFrame)))

        assert _claims(chain) == ["THINKING", "WORKING", "THINKING"]
        # The application authored no avatar traffic at all.
        assert chain.mid.of(AvatarControlFrame) == []

        # And the states are in front of the speech, not somewhere in the turn.
        kinds = chain.mid.names()
        assert kinds.index("LLMTextFrame") > kinds.index("FunctionCallResultFrame")


async def test_a_beat_of_zero_is_skipped_entirely(lines: CannedLines) -> None:
    """Off is off: no tool call, not a tool call that returns instantly.

    A zero-length work beat would still put `WORKING` on the wire, and the face
    would flick through a state the application never meant to be in.
    """
    async with Chain(lines, avatar=True, think_ms=40, work_ms=0) as chain:
        await chain.push(UserStoppedSpeakingFrame())
        await chain.until(lambda: bool(chain.mid.of(LLMFullResponseEndFrame)))

        assert _claims(chain) == ["THINKING"]
        assert not chain.mid.of(FunctionCallInProgressFrame)


async def test_an_interruption_mid_tool_retires_the_working_claim(
    lines: CannedLines,
) -> None:
    """The one way a canned tool call can end without a result.

    Nothing else retires a call, and `WORKING` is the bottom of the ladder — so
    a dangling one is not a missed beat, it is the state the face falls back to
    for the remainder of the session.
    """
    async with Chain(lines, avatar=True, work_ms=5_000) as chain:
        await chain.push(UserStoppedSpeakingFrame())
        await chain.until(lambda: _claims(chain) == ["THINKING", "WORKING"])

        await chain.push_up(BotStartedSpeakingFrame())
        await chain.push(InterruptionFrame())
        await chain.until(lambda: bool(chain.mid.of(FunctionCallCancelFrame)))
        await chain.push_up(BotStoppedSpeakingFrame())

        # The end of playout is where a stranded call would show itself: with
        # nothing else set, `WORKING` is what the ladder resolves to. Cancelled,
        # it resolves to nothing and the last thing said stands.
        assert _claims(chain) == ["THINKING", "WORKING", None]


def _claims(chain: Chain) -> list[str | None]:
    return [
        f.data["state"]
        for f in chain.out.of(RTVIServerMessageFrame)
        if f.data.get("cmd") == "claim"
    ]


async def test_a_turn_still_in_its_beats_will_not_start_a_second(
    lines: CannedLines,
) -> None:
    """The talk-over guard reads `BotStartedSpeakingFrame`, which has not been
    sent yet while the turn is still thinking. Without a second guard on the
    turn itself, a pause during the pause starts a whole extra line."""
    async with Chain(lines, think_ms=400) as chain:
        assert await chain.llm.say_next() is not None
        assert await chain.llm.say_next() is None


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


# --- the avatar seat --------------------------------------------------------


async def test_the_sentence_boundary_reaches_the_avatar(lines: CannedLines) -> None:
    """A real pipeline, not a synthetic frame — because this is the one fact the
    library cannot check for itself.

    `py/tests` drives `AvatarProcessor` with hand-built boundary frames, so it
    proves what the processor does *given* one. Whether a stock pipecat TTS
    actually emits one is a property of pipecat, and it depends on the service:
    the karaoke path emits `AggregatedTextProgressFrame` per word, and everything
    else emits a whole-sentence `TTSTextFrame` once the audio is queued. Miss the
    second case and nothing breaks visibly — the mouth still moves — but every
    accurate-leg rewrite splices at 0, so the wire carries the whole turn again on
    every audio frame and grows with the square of the turn (`visemes.py`, the
    comment above `splice_ms`). This canned TTS has no word timestamps, which is
    exactly the case that regressed.
    """
    line = next(l for l in lines.lines if len(l.sentences) > 1)
    async with Chain(lines, avatar=True, word_timings=False) as chain:
        await chain.llm.say(line)
        await chain.settle()
        # Generation finishing is not the last emission: the accurate leg's
        # closing rewrite rides `final`, from a decode still in flight.
        await chain.until(lambda: any(_cues(chain, final=True)))

    splices = [c["from_ms"] for c in _cues(chain)]
    assert splices, "the avatar seat emitted no cues at all"

    # `max() > 0` is not the assertion, and that is the trap: the *predicted* leg
    # splices a later sentence at an estimated offset with or without a boundary,
    # and the closing chunk always splices at the end. Both are nonzero while the
    # accurate leg is still rewriting from zero. What only a counted boundary can
    # produce is a rewrite of the LAST sentence alone, which is the second-to-last
    # chunk here — the last one is `final`.
    assert splices[-2] > 0, (
        f"the closing rewrite spliced at 0 over {len(splices)} emissions — the "
        f"boundary never reached the processor, so every chunk carried the whole turn"
    )
    # And quantitatively, since the failure is a volume one: only the first
    # sentence may be rewritten from zero. Measured 27 of 166 with the boundary
    # counted, 169 of 171 without — a wide enough gap that half is a safe floor
    # for a two-sentence line of any length.
    assert splices.count(0) < len(splices) / 2, (
        f"{splices.count(0)} of {len(splices)} chunks spliced at 0"
    )


def _cues(chain: Chain, *, final: bool | None = None) -> list[dict]:
    return [
        f.data
        for f in chain.out.of(RTVIServerMessageFrame)
        if f.data.get("cmd") == "cues" and (final is None or f.data["final"] is final)
    ]


async def test_word_timings_put_the_words_on_the_wire_in_order(lines: CannedLines) -> None:
    """The karaoke path, which is a different TTS shape and not a decoration.

    A transcript that highlights in time with the voice reads these — pipecat
    delivers them to the browser as `bot-output` — and the two properties it
    needs are that every word arrives and that the accumulated text only ever
    grows. Both are the base class's work, and both are lost the moment a word
    does not match the text it was synthesised from, which is a mistake this
    service is free to make on its own.

    **A progress frame accumulates within its sentence, not across the turn**,
    which is why the segments are separated first. A transcript that concatenates
    them blindly renders the second sentence over the first.
    """
    line = next(l for l in lines.lines if len(l.sentences) > 1)
    async with Chain(lines, word_timings=True) as chain:
        await chain.llm.say(line)
        await chain.settle()

    progress = chain.out.of(AggregatedTextProgressFrame)
    assert progress, "no word progress at all — this is the whole karaoke path"

    segments: dict[int, list[AggregatedTextProgressFrame]] = {}
    for frame in progress:
        segments.setdefault(frame.segment_id, []).append(frame)
    assert len(segments) == len(line.sentences), "a sentence produced no progress of its own"

    for sentence, frames in zip(line.sentences, segments.values()):
        grew = [f.accumulated_text for f in frames]
        assert grew == sorted(grew, key=len), "accumulated text went backwards"
        assert grew[-1].split() == sentence.text.split(), "the last word never completed"
        # And the last one says so, which is how a transcript knows to stop
        # highlighting rather than leaving a word lit for the rest of the call.
        assert frames[-1].remaining_text == ""


async def test_word_times_are_against_the_turn_and_not_the_sentence(
    lines: CannedLines,
) -> None:
    """The second sentence's first word does not start at zero.

    `record.py` captures each clip's timings relative to *that clip*, because
    that is what vql-speech reports and what a clip means on its own. Pipecat
    stamps against the audio context, and with `reuse_context_id_within_turn`
    one context spans the whole completion — the base class pins its zero to the
    first audio frame of the turn and never moves it again. So a service that
    hands over per-clip times unshifted claims every sentence begins the moment
    the turn did, and the transcript finishes early by the length of everything
    before the last sentence.

    Silent in a call, which is why it survived: the mouth is driven by audio and
    stays right. Only the highlight slides, and it slides *forward*, which reads
    as an eager transcript rather than a bug.
    """
    line = next(l for l in lines.lines if len(l.sentences) > 1)
    async with Chain(lines, word_timings=True) as chain:
        await chain.llm.say(line)
        await chain.settle()

    segments: dict[int, list[AggregatedTextProgressFrame]] = {}
    for frame in chain.out.of(AggregatedTextProgressFrame):
        segments.setdefault(frame.segment_id, []).append(frame)
    firsts = [frames[0].pts / 1_000_000 for frames in segments.values()]
    assert len(firsts) == len(line.sentences)

    # Each sentence starts after the one before it has been spoken. Compared
    # against the clip lengths rather than a constant, because the corpus is
    # re-recordable and these are real durations.
    elapsed = 0.0
    for sentence, start in zip(line.sentences, firsts):
        assert start == pytest.approx(elapsed, abs=15.0), (
            f"{sentence.text!r} claims to start at {start:.0f} ms of a turn that "
            f"has already spoken {elapsed:.0f} ms"
        )
        elapsed += sentence.ms

    # The whole turn's timeline, not just its starts: the last word of the last
    # sentence lands inside the turn's audio and near its end.
    last = max(f.pts for f in chain.out.of(AggregatedTextProgressFrame)) / 1_000_000
    assert 0.5 * elapsed < last < elapsed


async def test_the_sentence_boundary_reaches_the_avatar_on_the_karaoke_path(
    lines: CannedLines,
) -> None:
    """The same fact as its whole-sentence twin above, down the other branch.

    Two spellings of one boundary is exactly how the original defect hid: the
    reader handled this one and not the other, so it looked handled. Testing
    only the branch that regressed would leave the same shape of gap facing the
    other way.
    """
    line = next(l for l in lines.lines if len(l.sentences) > 1)
    async with Chain(lines, avatar=True, word_timings=True) as chain:
        await chain.llm.say(line)
        await chain.settle()
        await chain.until(lambda: any(_cues(chain, final=True)))

    splices = [c["from_ms"] for c in _cues(chain)]
    assert splices, "the avatar seat emitted no cues at all"
    assert splices[-2] > 0, "the closing rewrite spliced at 0 — no boundary was counted"
    assert splices.count(0) < len(splices) / 2, (
        f"{splices.count(0)} of {len(splices)} chunks spliced at 0"
    )
