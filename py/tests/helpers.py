"""Shared readers for the avatar suite.

Avatar assertions are almost always about an *ordered sequence*, so the tests
compare flattened strings (`"state:LISTENING"`, `"interject:CLAIM_FLOOR"`)
rather than dicts: a failing sequence assertion then prints as a readable
storyboard instead of ten lines of JSON.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from pipecat.clocks.system_clock import SystemClock
from pipecat.frames.frames import (
    AggregatedTextFrame,
    AggregatedTextProgressFrame,
    DataFrame,
    Frame,
    StartFrame,
    TTSTextFrame,
)
from pipecat.processors.frame_processor import (
    FrameDirection,
    FrameProcessor,
    FrameProcessorSetup,
)
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
from pipecat.utils.asyncio.task_manager import TaskManager, TaskManagerParams

from voqalize_avatar import AvatarMessage, AvatarProcessor


def _task_manager() -> TaskManager:
    """A `TaskManager` on whichever pipecat the consumer pinned.

    The constructor keyword arrived after our declared floor
    (`pipecat-ai>=1.4`), where the loop is supplied through `setup()` instead —
    and the package is meant to install anywhere in that range, so the harness
    has to span it too or "we support 1.4" is a claim no test ever checks. The
    library itself touches no pipecat API that moved; this is the only seam.
    """
    loop = asyncio.get_running_loop()
    try:
        return TaskManager(loop=loop)
    except TypeError:
        manager = TaskManager()
        manager.setup(TaskManagerParams(loop=loop))
        return manager


def sentence(text: str, ctx: str = "1.1") -> AggregatedTextFrame:
    """"This sentence is about to be spoken" — what a TTS service pushes just
    before the audio context it describes.

    The real one is built by pipecat's `AggregatedFrameSequencer`; this is the
    same frame with the two fields the avatar reads.
    """
    frame = AggregatedTextFrame(text=text, aggregated_by="sentence", context_id=ctx)
    # Not a constructor field upstream: the sequencer stamps it after building
    # the frame, and so does this.
    frame.will_be_spoken = True
    return frame


def word(text: str, ctx: str = "1.1") -> TTSTextFrame:
    """One karaoke word. Subclasses the announcement frame and carries the same
    `will_be_spoken`, which is why the avatar's discriminator is a negative
    isinstance check."""
    frame = TTSTextFrame(text=text, aggregated_by="sentence", context_id=ctx)
    frame.will_be_spoken = True
    return frame


def spoken(text: str, ctx: str = "1.1", *, remaining: str = "") -> AggregatedTextProgressFrame:
    """A karaoke progress frame. `remaining=""` is the sentence's last word,
    which is the cut signal — every sample of it is already behind it."""
    return AggregatedTextProgressFrame(
        segment_id=1,
        context_id=ctx,
        text=text,
        aggregated_by="sentence",
        accumulated_text=text,
        remaining_text=remaining,
    )


def flatten(message: AvatarMessage | dict[str, Any]) -> str:
    """`"cmd:salient-argument"` — the one field that identifies the command."""
    wire = message.to_wire() if isinstance(message, AvatarMessage) else message
    cmd = wire["cmd"]
    salient = {
        "state": "name",
        "claim": "state",
        "action": "id",
        "interject": "id",
        "speech": "event",
        "user": "speaking",
    }.get(cmd)
    if salient is None:
        return cmd
    return f"{cmd}:{wire[salient]}"


def sequence(messages: Iterable[AvatarMessage | dict[str, Any]]) -> list[str]:
    return [flatten(m) for m in messages]


def states(messages: Iterable[AvatarMessage | dict[str, Any]]) -> list[str]:
    """Just the state track — for assertions that don't care about the
    interjections and speech events woven through it."""
    return [s.split(":", 1)[1] for s in sequence(messages) if s.startswith("state:")]


@dataclass
class _Marker(DataFrame):
    """A frame with no meaning, used to find the back of the queue."""


class _Capture(FrameProcessor):
    """Records everything that reaches it, and reads the avatar traffic out."""

    def __init__(self) -> None:
        super().__init__(enable_direct_mode=True)
        self.wire: list[dict[str, Any]] = []
        self.frames: list[Frame] = []

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        self.frames.append(frame)
        if isinstance(frame, RTVIServerMessageFrame) and isinstance(frame.data, dict):
            self.wire.append(frame.data)

    @property
    def passed(self) -> list[Frame]:
        """The pipeline's own traffic — what arrived minus what the avatar
        added, which is the set the pass-through obligation is about."""
        return [f for f in self.frames if not isinstance(f, RTVIServerMessageFrame)]


class AvatarPipe:
    """Three linked processors around a real `AvatarProcessor`.

    The scenario tests next door drive a whole session; this drives the
    processor alone, for the cases a real pipeline cannot produce on demand —
    a reconnecting client, a frame arriving before `StartFrame` — and for
    proving the pass-through obligation frame by frame.

    Both neighbours capture. The downstream one stands where the output
    transport stands and is where the avatar's messages are read from; the
    upstream one stands where the LLM service stands, and its job is to stay
    empty of avatar traffic — a message sent that way would be serialized toward
    the LLM and block the pipeline on an ack that never comes.
    """

    def __init__(
        self,
        *,
        autostart: bool = True,
        cls: type[AvatarProcessor] = AvatarProcessor,
        **kwargs: Any,
    ) -> None:
        self.upstream = _Capture()
        self.avatar = cls(**kwargs)
        self.downstream = _Capture()
        # `autostart=False` leaves the processor un-started, which is the state
        # a real session is briefly in while StartFrame travels down the
        # pipeline and the browser's client-ready arrives out of band.
        self._autostart = autostart

    async def __aenter__(self) -> AvatarPipe:
        self.upstream.link(self.avatar)
        self.avatar.link(self.downstream)
        setup = FrameProcessorSetup(
            clock=SystemClock(),
            task_manager=_task_manager(),
            pipeline_worker=SimpleNamespace(app_resources=None),  # type: ignore[arg-type]
        )
        for p in (self.upstream, self.avatar, self.downstream):
            await p.setup(setup)
        if self._autostart:
            await self.start()
        return self

    async def start(self) -> None:
        await self.push(StartFrame(audio_in_sample_rate=16000, audio_out_sample_rate=24000))

    async def __aexit__(self, *exc: object) -> None:
        for p in (self.upstream, self.avatar, self.downstream):
            await p.cleanup()

    async def push(self, *frames: Frame) -> None:
        for frame in frames:
            await self.avatar.process_frame(frame, FrameDirection.DOWNSTREAM)

    async def queue(self, *frames: Frame) -> None:
        """Feed through the processor's own input queue rather than inline.

        The difference matters for the cut signals: they are meaningful only
        because they arrive *behind* the audio already queued ahead of them. A
        test that pushed both inline would be asserting on ordering it created
        itself.
        """
        for frame in frames:
            await self.avatar.queue_frame(frame, FrameDirection.DOWNSTREAM)

    async def settle(self, timeout: float = 2.0) -> None:
        """Wait until everything queued has been handled.

        A marker frame rather than a sleep: it rides the same queue, so it
        cannot arrive before the frames in front of it however slow the machine.
        """
        marker = _Marker()
        await self.avatar.queue_frame(marker, FrameDirection.DOWNSTREAM)
        deadline = asyncio.get_running_loop().time() + timeout
        while marker not in self.downstream.frames:
            if asyncio.get_running_loop().time() > deadline:
                raise TimeoutError("avatar processor did not drain its input queue")
            await asyncio.sleep(0.002)

    @property
    def wire(self) -> list[dict[str, Any]]:
        return self.downstream.wire

    @property
    def sent(self) -> list[str]:
        return sequence(self.downstream.wire)

    def drain(self) -> list[str]:
        """Take the messages so far and reset — scenario steps read better as
        'what did *this* step say'."""
        out = self.sent
        self.downstream.wire.clear()
        return out
