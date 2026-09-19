"""A handle on the running call, so an HTTP request can drive the avatar.

The pipeline is the only thing that can speak to the widget, and it lives inside
one `run_bot` task with no way in from outside. This is the way in: `run_bot`
registers a `Session`, an endpoint looks it up, and anything it sends is queued
at the head of the pipeline — the same seam an application's own bridge
processor uses (`voqalize_avatar/frames.py`), and therefore arriving in pipeline
order, interleaved with the frames the state machine inferred.

**One call at a time, deliberately.** A second browser replaces the first rather
than joining it. This is a local review server; a session map keyed by peer id
would be more code in service of a case that does not exist here, and the
endpoints would then need to say *which* call they meant.

The misbehaviours below are the reason this file is worth having at all. The
authority model says the client never obeys a server state that contradicts what
it can observe (`docs/pipecat-lifecycle-protocol.md` § Authority model), and that
is a claim about the *renderer*, not about the server. Nothing proved it: every
message this server sent was a well-formed message sent at the right moment. So
`Session.misbehave` sends the wrong thing on purpose, and you watch.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from loguru import logger
from pipecat.frames.frames import UserMuteStartedFrame, UserMuteStoppedFrame
from pipecat.pipeline.worker import PipelineWorker
from voqalize_avatar import AvatarAction, AvatarControlFrame, AvatarMessage, AvatarState

from canned import CannedLines, CannedLLMService, Line

#: What each misbehaviour is trying to make the renderer do wrong, and what it
#: should do instead. The value is the sentence shown next to the button — these
#: are only useful if you know what to watch for while they run.
MISBEHAVIOURS: dict[str, str] = {
    "state-during-speech": (
        "Says a line, then immediately sends THINKING. The face must keep "
        "speaking: observed playout outranks server intent."
    ),
    "stale-state": (
        "Sends THINKING, then clears it a beat after the turn it belonged to "
        "has ended. A state that arrives late must not resurface."
    ),
    "unknown-action": (
        "Sends an action name that does not exist. The face must ignore it and "
        "keep rendering, not stall on a command it cannot map."
    ),
    "unknown-state": (
        "Sends a state that is not in the vocabulary. Same bar: ignored, not "
        "rendered, not fatal."
    ),
    "action-storm": (
        "Twelve acknowledgements back to back. The face must not work through a "
        "queue of twelve nods long after the burst ended."
    ),
}

#: Names the *mounted face* has that the wire does not: this demo runs the
#: bundled SVG renderer, so it can offer a button for each of that renderer's
#: own actions alongside the two every avatar owes a server. Published by
#: `/api/lines` and the only thing `/api/action` checks against — a list here is
#: this server's knowledge of what is on the other end, never the protocol's
#: vocabulary, which is open (`docs/contract-wire.md`).
RENDERER_ACTIONS: list[str] = [
    "ACK_RECEIVE",
    "ACK_NOD",
    "GESTURE_GREET",
    "GESTURE_GOODBYE",
    "GESTURE_APPROVE",
    "GESTURE_WAIT",
]

#: Pause between the two halves of a two-step misbehaviour. Long enough that a
#: human sees them as separate events, short enough to stay inside one turn.
_BEAT_S = 0.4


@dataclass
class Session:
    """The live call, and everything an endpoint is allowed to do to it."""

    lines: CannedLines
    llm: CannedLLMService
    worker: PipelineWorker
    #: Serialises multi-step misbehaviours so two overlapping requests cannot
    #: interleave their halves and produce an order neither one describes.
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def send(self, message: AvatarMessage) -> None:
        """Queue one avatar command at the head of the pipeline."""
        await self.worker.queue_frame(AvatarControlFrame(message=message))

    async def say(self, line_id: str) -> Line:
        """Say one line by id, whatever the round-robin was going to say next."""
        line = next((n for n in self.lines.lines if n.id == line_id), None)
        if line is None:
            raise KeyError(line_id)
        await self.llm.say(line)
        return line

    async def state(self, state: AvatarState | None) -> None:
        await self.send(AvatarMessage.state(state))

    def beats(self, *, think_ms: int, work_ms: int) -> None:
        """Set how long the server holds each state before it starts speaking.

        Not a message and not a command — it changes what the *next* turn does,
        which is the honest shape of it. A caller who wants a state right now
        sends one; these are what an application's own latency looks like
        from the face's side, and the only way to see them is to have the server
        take as long as a real one would.
        """
        self.llm.think_ms = max(0, think_ms)
        self.llm.work_ms = max(0, work_ms)

    async def action(self, action: AvatarAction | str) -> None:
        await self.send(AvatarMessage.action(action))

    async def mute(self, on: bool) -> None:
        """Close the user's microphone from the agent's side, or open it again.

        Not an avatar command — nothing in the library is involved. These are the
        two stock frames a pipecat mute strategy broadcasts
        (`turns/user_mute/`), the RTVI observer turns them into
        `user-mute-started`/`user-mute-stopped`, and the browser client raises
        them as events. The face reads those directly, which is why "has muted
        you" costs no wire verb at all.

        Queued rather than driven by a real strategy because this pipeline has no
        context aggregator to hang one on — there is no STT and no LLM context
        here (`bot.py`). What goes on the wire is identical either way; what a
        strategy would add is a *reason*, and the reason is a person pressing the
        button.
        """
        frame = UserMuteStartedFrame() if on else UserMuteStoppedFrame()
        await self.worker.queue_frame(frame)

    async def misbehave(self, kind: str) -> None:
        """Send something wrong on purpose. See `MISBEHAVIOURS`."""
        if kind not in MISBEHAVIOURS:
            raise KeyError(kind)
        logger.info("misbehaving: {}", kind)

        async with self._lock:
            if kind == "state-during-speech":
                await self.llm.say(self.lines.lines[0], preamble=False)
                await asyncio.sleep(_BEAT_S)
                await self.state(AvatarState.THINKING)

            elif kind == "stale-state":
                await self.state(AvatarState.THINKING)
                await self.llm.say(self.lines.lines[0], preamble=False)
                await asyncio.sleep(_BEAT_S)
                await self.state(None)

            elif kind == "unknown-action":
                # Straight through the builder, because this is not a malformed
                # message: the action vocabulary is open, so a name no mounted
                # face has is a legal thing to send and a dropped one is the
                # forward-compat rule working. `AvatarMessage.action` takes a
                # plain string for exactly that reason.
                await self.send(AvatarMessage.action("GESTURE_SOMERSAULT"))

            elif kind == "unknown-state":
                # Not through `AvatarMessage.state`, which only accepts the enum.
                # The state list *is* closed, so this one really is malformed —
                # a raw payload is what a version skew actually puts on the wire.
                await self.send(AvatarMessage(cmd="state", payload={"state": "NAPPING"}))

            elif kind == "action-storm":
                for _ in range(12):
                    await self.action(AvatarAction.ACKNOWLEDGE)


#: The one live call, or `None`. Module state because there is one server
#: process, one pipeline and one browser; see the module docstring.
_live: Session | None = None


def register(session: Session) -> None:
    global _live
    if _live is not None:
        logger.info("replacing the previous call — this server takes one at a time")
    _live = session


def unregister(session: Session) -> None:
    """Clear the slot, unless a newer call already claimed it."""
    global _live
    if _live is session:
        _live = None


def live() -> Session | None:
    return _live
