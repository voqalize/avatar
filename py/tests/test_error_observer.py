"""The observer that closes the avatar's blind spot.

`ErrorFrame` travels upstream and the avatar sits at the downstream end, so
every failure in the session passes *behind* it. Left alone, an agent whose
brain has died goes on blinking and breathing as if the call were fine. These
tests drive real `FramePushed` events rather than calling the handler directly —
the dedup is about how many times one frame is announced, which only the event
shape shows.
"""

from __future__ import annotations

import pytest
from pipecat.frames.frames import ErrorFrame, FatalErrorFrame, TTSAudioRawFrame
from pipecat.observers.base_observer import FramePushed
from pipecat.processors.frame_processor import FrameDirection

from voqalize_avatar.error_observer import AvatarErrorObserver
from tests.helpers import AvatarPipe

pytestmark = pytest.mark.asyncio


def pushed(pipe: AvatarPipe, frame) -> FramePushed:
    """One hop, in the direction errors actually travel."""
    return FramePushed(
        source=pipe.downstream,
        destination=pipe.avatar,
        frame=frame,
        direction=FrameDirection.UPSTREAM,
        timestamp=0,
    )


async def test_a_non_fatal_error_degrades_the_avatar() -> None:
    async with AvatarPipe() as pipe:
        pipe.drain()
        observer = AvatarErrorObserver(pipe.avatar)
        await observer.on_push_frame(pushed(pipe, ErrorFrame(error="tts websocket dropped")))
        assert pipe.drain() == ["state:DEGRADED"]


async def test_a_fatal_error_takes_it_offline() -> None:
    async with AvatarPipe() as pipe:
        pipe.drain()
        observer = AvatarErrorObserver(pipe.avatar)
        await observer.on_push_frame(pushed(pipe, FatalErrorFrame(error="transport gone")))
        assert pipe.drain() == ["state:OFFLINE"]


async def test_one_error_crossing_five_processors_is_still_one_error() -> None:
    """An observer sees every hop. Without dedup a five-stage pipeline would
    report the same failure five times — harmless for a state (it dedups) and
    not harmless for anything that ever gets an interjection attached."""
    async with AvatarPipe() as pipe:
        pipe.drain()
        observer = AvatarErrorObserver(pipe.avatar)
        frame = ErrorFrame(error="one failure")
        for _ in range(5):
            await observer.on_push_frame(pushed(pipe, frame))
        assert pipe.drain() == ["state:DEGRADED"]
        # A *different* failure after recovery is a new event, not a repeat.
        await pipe.avatar.on_client_ready()
        pipe.drain()
        await observer.on_push_frame(pushed(pipe, FatalErrorFrame(error="another")))
        assert pipe.drain() == ["state:OFFLINE"]


async def test_the_dedup_memory_is_bounded() -> None:
    """A session erroring in a loop must not grow a set for its whole length."""
    async with AvatarPipe() as pipe:
        observer = AvatarErrorObserver(pipe.avatar, memory=4)
        for _ in range(50):
            await observer.on_push_frame(pushed(pipe, ErrorFrame(error="flapping")))
        assert len(observer._seen) == 4


async def test_ordinary_traffic_costs_one_isinstance() -> None:
    async with AvatarPipe() as pipe:
        pipe.drain()
        observer = AvatarErrorObserver(pipe.avatar)
        frame = TTSAudioRawFrame(audio=b"\x00" * 96, sample_rate=24000, num_channels=1)
        await observer.on_push_frame(pushed(pipe, frame))
        assert pipe.drain() == []
