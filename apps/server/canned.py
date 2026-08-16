"""A pipecat LLM and TTS that need no API key, no model and no network.

The point of this server is the avatar, not the conversation. Every vendor
service the pipeline used to name — Vertex for the LLM, Google or Cartesia for
the voice — is a credential someone has to obtain before they can look at a
talking head, and the talking head is identical either way. So the default
pipeline says a fixed set of sentences and plays a WAV recorded for each one.

**This is not a mock.** It is a real `LLMService` and a real `TTSService`,
pushing the real frames in the real order, so `AvatarProcessor` downstream
cannot tell the difference and neither can the wire. What it is not is a
*generator*: the audio for a sentence already exists in full when synthesis
starts, so arrival timing is simulated (see `speed` below) rather than observed.
That is the one thing this path cannot verify, and it is why `--tts google` and
`--tts vql-speech` are still here — see README § Verifying lipsync.

The corpus is closed and keyed by sentence, which is not an arbitrary shape:
`TTSService` aggregates text to sentence boundaries before calling `run_tts`, so
a two-sentence line arrives here as two separate calls and needs two clips. A
corpus keyed by whole line would miss on the first line containing a full stop —
and miss *silently*, as a sentence with no audio.
"""

from __future__ import annotations

import asyncio
import json
import re
import wave
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from pathlib import Path

from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    Frame,
    FunctionCallCancelFrame,
    FunctionCallInProgressFrame,
    FunctionCallResultFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TTSAudioRawFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.llm_service import LLMService
from pipecat.services.settings import LLMSettings, TTSSettings
from pipecat.services.tts_service import TTSService

#: Every canned tool call is named from this. One prefix, so a test can tell a
#: beat's call from anything else in the frame stream without matching on a
#: literal spelled in two files.
TOOL_CALL_PREFIX = "canned-tool-"

#: Lookup key for a sentence. Pipecat's aggregator hands `run_tts` text that has
#: been through filters and transforms, so it may differ from the corpus by
#: whitespace or a trailing space it was asked to append. Matching on the
#: normalised form is what keeps a cosmetic difference from reading as a missing
#: clip.
def _key(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


@dataclass(frozen=True)
class Sentence:
    """One sentence, the audio recorded for it, and what vql-speech said it did.

    `words` is the service's own word timestamps from the recording session, as
    `(word, start_ms)` pairs relative to the start of this clip — not an estimate
    made here. Nothing in this file knows how to place a word inside a clip, and
    that is the point: the karaoke the default path shows is the karaoke a live
    `--tts vql-speech` call would show.
    """

    text: str
    audio: Path
    ms: float
    words: tuple[tuple[str, float], ...]


@dataclass(frozen=True)
class Line:
    """One thing the avatar can say, as the sentences it breaks into."""

    id: str
    tag: str
    sentences: tuple[Sentence, ...]

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.sentences)


@dataclass(frozen=True)
class Voice:
    """Who is speaking — one id, both paths.

    The avatar is drawn as a person and a voice that disagrees with the drawing
    breaks the illusion faster than any lipsync error does — so the voice is a
    choice a caller makes, and it has to mean the same thing whichever TTS is
    behind it. `vql_speech` is that id: what `--tts vql-speech` streams live, and
    what `record.py` already asked for when it wrote `audio/<name>/`. The default
    path and the vendor path are the same person, which they were not while the
    recordings were a licence-clean stand-in.
    """

    name: str
    label: str
    vql_speech: str


def load_voices(path: Path) -> dict[str, Voice]:
    """The voice table, without loading (or requiring) any audio.

    Separate from `CannedLines.load` on purpose: the server advertises the list
    before a call exists, and at that point the clips for the voice nobody has
    picked yet are not its business.
    """
    raw = json.loads(path.read_text())
    return {
        name: Voice(name=name, label=v["label"], vql_speech=v["vql_speech"])
        for name, v in raw["voices"].items()
    }


def default_voice(path: Path) -> str:
    return json.loads(path.read_text())["default_voice"]


class CannedLines:
    """The corpus, validated at load rather than at the first call.

    Everything checked here fails the same way if it is not: the avatar's mouth
    moves and no sound comes out, which looks like a lipsync bug and is not one.
    A missing file, a stereo clip, an 8 kHz clip and a clip at the wrong bit
    depth are all indistinguishable from a working demo until you have your
    headphones on, so none of them is allowed to reach a call.
    """

    def __init__(self, lines: list[Line], sample_rate: int, voice: Voice):
        self.lines = lines
        self.sample_rate = sample_rate
        #: Who these recordings are. Carried on the corpus rather than passed
        #: alongside it so a vendor TTS built from the same corpus asks for the
        #: matching voice without anyone having to remember to thread it through.
        self.voice = voice

        self._by_key = {_key(s.text): s for line in lines for s in line.sentences}

    @classmethod
    def load(cls, path: Path, voice: str | None = None) -> CannedLines:
        raw = json.loads(path.read_text())
        sample_rate = raw["sample_rate"]
        name = voice or raw["default_voice"]
        if name not in raw["voices"]:
            raise ValueError(f"no voice {name!r} in {path} — have {list(raw['voices'])}")
        chosen = load_voices(path)[name]
        # One text corpus, one recording of it per voice. The text is authored
        # once and the directory is the only thing that varies, so a line added
        # for one voice cannot go missing for the other — it goes missing for
        # both, loudly, at load.
        root = path.parent / "audio" / name
        timings = _load_timings(root)

        lines: list[Line] = []
        for entry in raw["lines"]:
            sentences = []
            for s in entry["sentences"]:
                audio = root / s["audio"]
                ms = _probe(audio, sample_rate)
                sentences.append(
                    Sentence(
                        text=s["text"], audio=audio, ms=ms, words=_words(timings, audio, ms)
                    )
                )
            lines.append(
                Line(id=entry["id"], tag=entry.get("tag", ""), sentences=tuple(sentences))
            )

        if not lines:
            raise ValueError(f"{path} lists no lines")
        return cls(lines, sample_rate, chosen)

    def find(self, text: str) -> Sentence | None:
        return self._by_key.get(_key(text))

    def by_tag(self, tag: str) -> list[Line]:
        return [line for line in self.lines if line.tag == tag]

    def __len__(self) -> int:
        return len(self.lines)


def _probe(audio: Path, sample_rate: int) -> float:
    """Open a clip and insist it is what the pipeline was told to expect."""
    if not audio.exists():
        raise FileNotFoundError(f"canned clip missing: {audio}")
    with wave.open(str(audio)) as w:
        if w.getnchannels() != 1:
            raise ValueError(f"{audio}: {w.getnchannels()} channels, need mono")
        if w.getsampwidth() != 2:
            raise ValueError(f"{audio}: {w.getsampwidth() * 8}-bit, need 16")
        if w.getframerate() != sample_rate:
            raise ValueError(f"{audio}: {w.getframerate()} Hz, corpus declares {sample_rate}")
        return w.getnframes() / w.getframerate() * 1000.0


def _load_timings(root: Path) -> dict:
    """The word timestamps `record.py` captured from vql-speech for this voice."""
    path = root / "timings.json"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} missing — re-run apps/server/record.py; the WAVs alone are not a corpus"
        )
    return json.loads(path.read_text())["sentences"]


def _words(timings: dict, audio: Path, ms: float) -> tuple[tuple[str, float], ...]:
    """One clip's word timings, insisted on being about *this* clip.

    The two files are written in the same pass and can only disagree if one of
    them was replaced without the other — a re-recording that skipped
    `timings.json`, or the reverse. That drift is silent in a call: the mouth and
    the audio are still right, and only the transcript slides, by however much
    the two recordings differed. Checking the duration catches it at load, where
    the fix is one command.
    """
    entry = timings.get(audio.name)
    if entry is None:
        raise FileNotFoundError(f"{audio.name} has no entry in {audio.parent}/timings.json")
    if abs(float(entry["ms"]) - ms) > 1.0:
        raise ValueError(
            f"{audio}: {ms:.0f} ms of audio against {entry['ms']:.0f} ms of timings — "
            f"the two were recorded separately; re-run apps/server/record.py"
        )
    return tuple(zip(entry["words"], (float(v) for v in entry["start_ms"])))


class CannedTTSService(TTSService):
    """Plays the clip recorded for a sentence, as if it had just synthesised it.

    `push_start_frame` and `push_stop_frames` are on because the base class only
    emits `TTSStartedFrame`/`TTSStoppedFrame` when asked, and the avatar's
    speaking state is driven by exactly those two frames. With them off the face
    never opens its mouth and the audio plays anyway — the single most confusing
    failure this path has.

    `run_tts` therefore yields **only** `TTSAudioRawFrame`. The base class emits
    the started, stopped and text frames itself; yielding them here would double
    every one of them.

    **`word_timings` decides which of the two TTS shapes this is.** Pipecat has
    one switch for it, `push_text_frames`, and the two sides of it are genuinely
    different wire traffic: with timings the base class emits a `TTSTextFrame`
    and an `AggregatedTextProgressFrame` per *word*, clocked to playout by the
    output transport, which is what a karaoke transcript reads and what
    `AvatarProcessor` splices sentences on; without them it emits one
    whole-sentence `TTSTextFrame` after synthesis, and that is the path a missing
    read once broke silently (`test_the_sentence_boundary_reaches_the_avatar`).
    Both are real vendor behaviour, so both stay reachable.
    """

    #: How much faster than real time to hand over audio. A real TTS runs ahead
    #: of playback but not infinitely ahead, and dumping a whole utterance in one
    #: tick is the least realistic thing this service could do: it would hand the
    #: aligner the entire waveform before the first sample is audible, so the
    #: accurate leg would always win the race it is supposed to sometimes lose.
    #: 2x is a plausible generator. Set 0 for no pacing.
    DEFAULT_SPEED = 2.0

    #: 20 ms per frame, matching what the transports use. Larger chunks make the
    #: pacing coarse; smaller ones buy nothing at 24 kHz.
    CHUNK_MS = 20

    def __init__(
        self,
        *,
        lines: CannedLines,
        speed: float = DEFAULT_SPEED,
        word_timings: bool = True,
        **kwargs,
    ):
        super().__init__(
            push_start_frame=True,
            push_stop_frames=True,
            # Inverted on purpose: `push_text_frames` is pipecat's spelling of
            # "this service has no word timestamps", so the service that *has*
            # them turns it off.
            push_text_frames=not word_timings,
            sample_rate=lines.sample_rate,
            # `None` is how a service says "I do not support this", and every
            # field has to say something: `AIService.start()` logs an error for
            # each one left at NOT_GIVEN. There is no model and no voice to pick
            # here — the recording already chose both.
            settings=TTSSettings(model=None, voice=None, language=None),
            **kwargs,
        )
        self._lines = lines
        self._speed = speed
        self._word_timings = word_timings
        #: How much audio this turn has already handed over, per context. See
        #: `run_tts` — a word timestamp is not about its own sentence, it is
        #: about the turn.
        self._spoken_ms: dict[str, float] = {}

    def can_generate_metrics(self) -> bool:
        return False

    async def on_audio_context_completed(self, context_id: str) -> None:
        self._spoken_ms.pop(context_id, None)

    async def on_audio_context_interrupted(self, context_id: str) -> None:
        self._spoken_ms.pop(context_id, None)

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        sentence = self._lines.find(text)
        if sentence is None:
            # Loud on purpose. The corpus is closed, so this means the LLM said
            # something no one recorded — a corpus bug, not a runtime condition
            # to be tolerated.
            logger.error("no canned clip for {!r}", text)
            yield ErrorFrame(error=f"no canned clip for {text!r}")
            return

        with wave.open(str(sentence.audio)) as w:
            pcm = w.readframes(w.getnframes())

        chunk = int(self.sample_rate * self.CHUNK_MS / 1000) * 2  # 16-bit mono
        delay = (self.CHUNK_MS / 1000) / self._speed if self._speed else 0

        await self.start_tts_usage_metrics(text)

        # Ahead of the audio, as a streaming vendor sends them — the base class
        # holds them until the first sample establishes the playout baseline, so
        # they are stamped against when the audio actually left, not when this
        # coroutine happened to run.
        #
        # **That baseline is the turn's, not the sentence's.** One audio context
        # spans a whole completion, and `start_word_timestamps` fixes the zero
        # point on its first audio frame — so a timestamp handed over here is an
        # offset from the *first* sentence of the turn. Cartesia's own frames are
        # cumulative for exactly this reason, and vql-speech offsets each
        # sentence by the audio already streamed on the context. Replaying
        # per-clip times unshifted put every sentence after the first back on the
        # first one's clock: on `greet`, the second sentence began highlighting
        # at 0 ms rather than 890, and the transcript finished 1.4 s ahead of the
        # voice. Nothing about the mouth or the audio changes, which is why it
        # survived a real call.
        if self._word_timings:
            spoken_ms = self._spoken_ms.get(context_id, 0.0)
            await self.add_word_timestamps(
                [(word, (spoken_ms + at) / 1000.0) for word, at in sentence.words], context_id
            )
            self._spoken_ms[context_id] = spoken_ms + sentence.ms

        for offset in range(0, len(pcm), chunk):
            if delay:
                await asyncio.sleep(delay)
            yield TTSAudioRawFrame(
                audio=pcm[offset : offset + chunk],
                sample_rate=self.sample_rate,
                num_channels=1,
                context_id=context_id,
            )


class CannedLLMService(LLMService):
    """Says the next line in the corpus whenever the user stops talking.

    There is no context, no aggregator pair and no STT in this pipeline, so the
    frames a vendor LLM keys off — `LLMContextFrame`, produced by the aggregator
    from a transcription — never appear. `UserStoppedSpeakingFrame` does, from
    the `UserTurnProcessor` upstream, and it is the honest trigger anyway: this
    service is not answering what was said, it is taking its turn.

    Note the explicit `push_frame` on every path. `LLMService.process_frame` does
    not forward frames downstream — neither does `AIService`'s or
    `FrameProcessor`'s — so a subclass that forgets this stalls the pipeline with
    no error.
    """

    #: How long to hold each pre-speech beat, in ms. `0` skips it.
    #:
    #: A real LLM takes a second to think and longer to run a tool, and the whole
    #: point of the claim vocabulary is what the face does during that second.
    #: This service answers instantly, so without a deliberate pause the states
    #: exist on the wire and never on screen — the first run showed a face that
    #: only ever listened and spoke, and nobody could tell the difference between
    #: "THINKING is not implemented" and "THINKING was over before a frame
    #: rendered". Thinking is on by default because every turn has some; working
    #: is off because only a turn that calls a tool does.
    DEFAULT_THINK_MS = 700
    DEFAULT_WORK_MS = 0

    def __init__(self, *, lines: CannedLines, **kwargs):
        super().__init__(
            # See `CannedTTSService.__init__`: every settings field must be
            # initialized, and nothing generates here, so all of them are None.
            settings=LLMSettings(
                model=None,
                system_instruction=None,
                temperature=None,
                max_tokens=None,
                top_p=None,
                top_k=None,
                frequency_penalty=None,
                presence_penalty=None,
                seed=None,
                filter_incomplete_user_turns=None,
                user_turn_completion_config=None,
            ),
            **kwargs,
        )
        self._lines = lines
        # NOT `_next`: `FrameProcessor._next` is the link pointer to the
        # downstream processor, and shadowing it replaces the pipeline's own
        # wiring with an integer.
        self._cursor = 0
        self._speaking = False
        self._turn: asyncio.Task | None = None
        self._tool_call_id: str | None = None
        self.think_ms = self.DEFAULT_THINK_MS
        self.work_ms = self.DEFAULT_WORK_MS

    def can_generate_metrics(self) -> bool:
        return False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        # Whether the bot is still talking is not knowable from what this service
        # pushed — pushing a line queues frames and returns immediately, long
        # before a sample is audible. The output transport is the only thing that
        # knows, and it says so with these two, travelling back upstream.
        if isinstance(frame, BotStartedSpeakingFrame):
            self._speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._speaking = False
        elif isinstance(frame, InterruptionFrame):
            self._speaking = False
            # A turn interrupted during its thinking beat is abandoned, not
            # finished quietly in the background: the user talked over the pause,
            # and the line it was about to say is no longer the reply.
            await self._abandon_turn()

        await self.push_frame(frame, direction)

        if isinstance(frame, UserStoppedSpeakingFrame):
            await self.say_next()

    async def say_next(self) -> Line | None:
        """Take the next turn. Also the opening line, called on client ready.

        Declines while the bot is still speaking, and while a turn is in its
        pre-speech beats. Without the first, a pause in the middle of the user's
        own sentence queues a second line behind the first and the avatar talks
        over itself for the rest of the call; without the second, the same pause
        lands in the `THINKING` hold, when nothing is speaking yet and the guard
        would wave it through.

        A turn with beats runs as a task, because `preamble` sleeps and this is
        called from `process_frame` — a processor that blocks there stops
        forwarding frames for as long as it blocks, which would hold up the very
        audio the beats are meant to precede. A turn with no beats has nothing to
        hold, so it stays inline: the task exists for the sleeping.
        """
        if self._speaking or self._in_turn():
            return None
        line = self._lines.lines[self._cursor % len(self._lines)]
        self._cursor += 1
        if self.think_ms <= 0 and self.work_ms <= 0:
            await self.say(line)
        else:
            self._turn = self.create_task(self.say(line), name="canned-turn")
        return line

    def _in_turn(self) -> bool:
        return self._turn is not None and not self._turn.done()

    async def _abandon_turn(self) -> None:
        if self._in_turn():
            await self.cancel_task(self._turn)
        self._turn = None
        if self._tool_call_id is not None:
            # A cancelled task never reaches its own result frame, and nothing
            # else retires a call. Left unsaid, the avatar spends the rest of
            # the session claiming `WORKING` on a tool that stopped existing.
            await self.push_frame(
                FunctionCallCancelFrame(
                    function_name="canned_tool", tool_call_id=self._tool_call_id
                )
            )
            self._tool_call_id = None

    async def preamble(self) -> None:
        """Hold the pre-speech beats — as the frames a real LLM emits, not as claims.

        These used to be `AvatarControlFrame` claims, on the reasoning that
        thinking is not a frame. It is, near enough. `LLMFullResponseStartFrame`
        goes out *before* the model is asked, so the stretch from there to the
        first audible word is the wait itself, and `AvatarProcessor` infers
        `THINKING` across it without being told anything. A tool call is less
        ambiguous still — pipecat has frames for precisely that, and the state
        machine counts them.

        Faking both meant this server exercised the one path a real deployment
        never takes while the inference every deployment depends on went unrun.
        That is how a claimless model-latency window survived to be reported from
        a live call rather than caught here.

        There is no clear any more, and none is missing: a claim raised by
        inference is retired by inference. `BotStartedSpeakingFrame` ends the
        wait; the tool's result ends the work.

        The call is cancelled rather than left dangling if the turn is abandoned
        — see `_abandon_turn`. A tool with no result and no cancel is a `WORKING`
        claim with nothing left to retire it.
        """
        if self.think_ms > 0:
            await asyncio.sleep(self.think_ms / 1000)
        if self.work_ms > 0:
            call = dict(
                function_name="canned_tool",
                tool_call_id=f"{TOOL_CALL_PREFIX}{self._cursor}",
                arguments={},
            )
            # Held across the sleep so an interruption can cancel it by id; not
            # cleared in a `finally`, because the cancelling code runs *after*
            # this coroutine unwinds and would find it already gone.
            self._tool_call_id = call["tool_call_id"]
            await self.push_frame(
                FunctionCallInProgressFrame(**call, cancel_on_interruption=True)
            )
            await asyncio.sleep(self.work_ms / 1000)
            await self.push_frame(FunctionCallResultFrame(**call, result={}))
            self._tool_call_id = None

    async def say(self, line: Line, *, preamble: bool = True) -> None:
        """Emit one line as a vendor LLM would emit a completion.

        The start frame comes first, before the beats: a vendor LLM pushes it
        immediately before asking the model, so everything the turn spends
        waiting happens *inside* the response, not in front of it. That ordering
        is the whole reason the beats no longer need to announce themselves.

        The end frame is not optional: `TTSService` uses it to flush its sentence
        aggregator and close the audio context, so without it the last sentence
        is synthesised late or not at all.

        `preamble=False` is for the misbehaviours, which author a precise
        sequence of their own and would be describing a different one if a beat
        were injected into it.
        """
        await self.push_frame(LLMFullResponseStartFrame())
        if preamble:
            await self.preamble()
        for sentence in line.sentences:
            # The trailing space is load-bearing. `TTSService`'s aggregator sees a
            # token stream, not sentences, so a full stop alone is not a boundary —
            # it waits for the next character to tell "Hello. " from "3.14". Without
            # the space the whole line arrives at `run_tts` as one run-on string
            # ("Hello.I'm a talking head…") that matches no clip. A real LLM's
            # tokens carry their own whitespace; ours have to be given it.
            await self.push_frame(LLMTextFrame(sentence.text + " "))
        await self.push_frame(LLMFullResponseEndFrame())
