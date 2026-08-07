"""Telling the avatar about failures it is seated too far downstream to see.

`ErrorFrame` travels UPSTREAM. The avatar sits between TTS and the output
transport, which is downstream of everything that fails — the LLM bridge, the
TTS websocket, the STT service — so every error passes *behind* the seat on its
way to the pipeline task. Left alone, the one state the avatar most needs to be
able to show is the one it can never reach: an agent whose brain has died goes
on breathing and blinking as if the call were fine.

An observer is the right tool and not a workaround: it sees every push in every
direction with no seat in the pipeline, which is exactly the asymmetry to
correct. The transitions themselves are not duplicated — this calls into the
same state machine an inline `ErrorFrame` would have driven.
"""

from __future__ import annotations

from pipecat.frames.frames import ErrorFrame
from pipecat.observers.base_observer import BaseObserver, FramePushed

from .processor import AvatarProcessor


class AvatarErrorObserver(BaseObserver):
    """Watches for `ErrorFrame`s anywhere and degrades (or kills) the avatar."""

    def __init__(self, processor: AvatarProcessor, *, memory: int = 64) -> None:
        super().__init__()
        self._processor = processor
        # One error is pushed once per hop, so a frame crossing five processors
        # arrives here five times. Dedup by identity, bounded — a session that
        # errors continuously must not grow a set for the length of the call.
        self._seen: list[int] = []
        self._memory = memory

    async def on_push_frame(self, data: FramePushed) -> None:
        frame = data.frame
        if not isinstance(frame, ErrorFrame):
            return
        if frame.id in self._seen:
            return
        self._seen.append(frame.id)
        if len(self._seen) > self._memory:
            del self._seen[: len(self._seen) - self._memory]
        await self._processor.on_error(fatal=frame.fatal)
