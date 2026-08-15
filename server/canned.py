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

#: Lookup key for a sentence. Pipecat's aggregator hands `run_tts` text that has
#: been through filters and transforms, so it may differ from the corpus by
#: whitespace or a trailing space it was asked to append. Matching on the
#: normalised form is what keeps a cosmetic difference from reading as a missing
#: clip.
def _key(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


@dataclass(frozen=True)
class Sentence:
    """One sentence and the audio recorded for it."""

    text: str
    audio: Path
    ms: float


@dataclass(frozen=True)
class Line:
    """One thing the avatar can say, as the sentences it breaks into."""

    id: str
    tag: str
    sentences: tuple[Sentence, ...]

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.sentences)


class CannedLines:
    """The corpus, validated at load rather than at the first call.

    Everything checked here fails the same way if it is not: the avatar's mouth
    moves and no sound comes out, which looks like a lipsync bug and is not one.
    A missing file, a stereo clip, an 8 kHz clip and a clip at the wrong bit
    depth are all indistinguishable from a working demo until you have your
    headphones on, so none of them is allowed to reach a call.
    """

    def __init__(self, lines: list[Line], sample_rate: int):
        self.lines = lines
        self.sample_rate = sample_rate
        self._by_key = {_key(s.text): s for line in lines for s in line.sentences}

    @classmethod
    def load(cls, path: Path) -> CannedLines:
        raw = json.loads(path.read_text())
        sample_rate = raw["sample_rate"]
        root = path.parent

        lines: list[Line] = []
        for entry in raw["lines"]:
            sentences = []
            for s in entry["sentences"]:
                audio = root / s["audio"]
                sentences.append(
                    Sentence(text=s["text"], audio=audio, ms=_probe(audio, sample_rate))
                )
            lines.append(
                Line(id=entry["id"], tag=entry.get("tag", ""), sentences=tuple(sentences))
            )

        if not lines:
            raise ValueError(f"{path} lists no lines")
        return cls(lines, sample_rate)

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

    def __init__(self, *, lines: CannedLines, speed: float = DEFAULT_SPEED, **kwargs):
        super().__init__(
            push_start_frame=True,
            push_stop_frames=True,
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

    def can_generate_metrics(self) -> bool:
        return False

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

        await self.push_frame(frame, direction)

        if isinstance(frame, UserStoppedSpeakingFrame):
            await self.say_next()

    async def say_next(self) -> Line | None:
        """Take the next turn. Also the opening line, called on client ready.

        Declines while the bot is still speaking. Without that, a pause in the
        middle of the user's own sentence queues a second line behind the first
        and the avatar talks over itself for the rest of the call.
        """
        if self._speaking:
            return None
        line = self._lines.lines[self._cursor % len(self._lines)]
        self._cursor += 1
        await self.say(line)
        return line

    async def say(self, line: Line) -> None:
        """Emit one line as a vendor LLM would emit a completion.

        The end frame is not optional: `TTSService` uses it to flush its sentence
        aggregator and close the audio context, so without it the last sentence
        is synthesised late or not at all.
        """
        await self.push_frame(LLMFullResponseStartFrame())
        for sentence in line.sentences:
            # The trailing space is load-bearing. `TTSService`'s aggregator sees a
            # token stream, not sentences, so a full stop alone is not a boundary —
            # it waits for the next character to tell "Hello. " from "3.14". Without
            # the space the whole line arrives at `run_tts` as one run-on string
            # ("Hello.I'm a talking head…") that matches no clip. A real LLM's
            # tokens carry their own whitespace; ours have to be given it.
            await self.push_frame(LLMTextFrame(sentence.text + " "))
        await self.push_frame(LLMFullResponseEndFrame())
