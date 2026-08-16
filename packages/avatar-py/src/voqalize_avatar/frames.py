"""The one frame an application pushes to drive the avatar itself.

The browser infers factual states — listening, speaking, connectivity — from
Pipecat JavaScript events. The server state machine supplies only lower-priority
`THINKING`/`WORKING` claims and explicit actions.

The application still knows things a generic pipeline cannot: that a long task
is `WORKING`, or that a deliberate `NOD_SLOW` is appropriate. A library that
guessed would nod at the wrong moment, which is worse than not nodding at all.

So the seam is explicit and it is one frame wide. Write a `FrameProcessor` in
your own pipeline, push `AvatarControlFrame` when you know something the
pipeline cannot see, and it reaches the widget with the same authority as
anything the state machine inferred:

    class ToolAvatarBridge(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, MyToolStartedFrame):
                await self.push_frame(
                    AvatarControlFrame(AvatarMessage.claim(AvatarClaim.WORKING)),
                    direction,
                )
            await self.push_frame(frame, direction)

Place the bridge anywhere upstream of `AvatarProcessor` and the control frames
arrive in pipeline order, interleaved with the inferred ones.

The browser resolves claims below factual speech states and retires them at real
turn boundaries so delayed server intent cannot resurface stale. Actions are
self-completing and return to that current resolved state.
"""

from __future__ import annotations

from dataclasses import dataclass

from pipecat.frames.frames import DataFrame

from .messages import AvatarMessage


@dataclass
class AvatarControlFrame(DataFrame):
    """An explicit avatar instruction from the application's own pipeline.

    A `DataFrame`, not a `SystemFrame`, on purpose: it travels in order with the
    speech it is meant to accompany rather than jumping the audio queue. An
    instruction that overtakes the sentence it belongs to is a gesture on the
    wrong words.

    Build `message` with `AvatarMessage.claim()` or `AvatarMessage.action()`.
    They are the only builders that know the wire payload keys.
    """

    message: AvatarMessage = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        super().__post_init__()
        if self.message is None:
            raise ValueError("AvatarControlFrame requires a message")

    def __str__(self) -> str:
        return f"{self.name}(cmd: {self.message.cmd})"
