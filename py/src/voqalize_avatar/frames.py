"""The one frame an application pushes to drive the avatar itself.

`AvatarStateMachine` infers the *base* states — listening, thinking, speaking,
taking the floor, yielding, degraded — from frames every pipecat pipeline
already produces. That works because those states are properties of the
pipeline: the user's voice started, TTS claimed the floor, an error travelled
upstream. Nothing has to be told.

The rest of the vocabulary is not like that. `TYPING`, `SEARCHING_SCREEN`,
`REVIEWING_SCREEN`, `DISTRACTED`, a deliberate `NOD_SLOW`, a `perform()`
timeline — these are properties of what the *application* is doing, and no
amount of frame-watching recovers them. A library that guessed would nod at the
wrong moment, which is worse than not noding at all.

So the seam is explicit and it is one frame wide. Write a `FrameProcessor` in
your own pipeline, push `AvatarControlFrame` when you know something the
pipeline cannot see, and it reaches the widget with the same authority as
anything the state machine inferred:

    class ToolAvatarBridge(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, MyToolStartedFrame):
                await self.push_frame(
                    AvatarControlFrame(AvatarMessage.state(AvatarState.SEARCHING_SCREEN)),
                    direction,
                )
            await self.push_frame(frame, direction)

Place the bridge anywhere upstream of `AvatarProcessor` and the control frames
arrive in pipeline order, interleaved with the inferred ones.

**Precedence is arrival order, and that is a decision, not an oversight.** A
control frame does not lock out the heuristics, carry a time-to-live, or claim
ownership of a channel; if the state machine infers `LISTENING` a moment after
you asked for `TYPING`, `LISTENING` wins because it happened later. A priority
lattice is the obvious next thing to build and there is not yet a second
consumer whose collisions would tell us what shape it should be. What the
library owes in the meantime is that the fight be *visible* rather than
theoretical — every emitted message carries its origin, so a collision shows up
in the wire log instead of being reasoned about.
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

    Build `message` with the `AvatarMessage` classmethods — `state()`,
    `interject()`, `gesture()`, `perform()`, `gaze` via `state(..., gaze=...)`.
    They are the only things that know the widget's payload keys.
    """

    message: AvatarMessage = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        super().__post_init__()
        if self.message is None:
            raise ValueError("AvatarControlFrame requires a message")

    def __str__(self) -> str:
        return f"{self.name}(cmd: {self.message.cmd})"
