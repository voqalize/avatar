"""The small avatar wire vocabulary shared with the browser.

Everything travels as one RTVI `server-message` shape:

    {"type": "avatar", "cmd": "claim", "state": "THINKING"}

`type` is the whole envelope. There is no version field: RTVI carries the payload
opaquely, so a version would have been ours to invent and ours to check, and
neither end ever checked it. The compatibility rule it stood for is real and
survives it — the client ignores a `cmd` it does not know, so adding a verb is
backward compatible and changing the meaning of one is not. The two packages
version in lockstep from one git tag (`RELEASING.md`), which is the mechanism
that actually keeps the ends together.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

AVATAR_MESSAGE_TYPE = "avatar"


class AvatarClaim(StrEnum):
    """Durable server intent below Pipecat's factual speech states."""

    THINKING = "THINKING"
    WORKING = "WORKING"


class AvatarAction(StrEnum):
    """The compact, semantic server action vocabulary."""

    ACK_RECEIVE = "ACK_RECEIVE"
    ACK_NOD = "ACK_NOD"
    RESPONSE_INTERRUPTED = "RESPONSE_INTERRUPTED"
    GESTURE_GREET = "GESTURE_GREET"
    GESTURE_GOODBYE = "GESTURE_GOODBYE"
    GESTURE_APPROVE = "GESTURE_APPROVE"
    GESTURE_WAIT = "GESTURE_WAIT"


@dataclass(frozen=True)
class AvatarMessage:
    """One command for the widget. `to_wire()` wraps it in the envelope.

    Construct through the classmethods, never the raw fields: they are the only
    place that knows a payload's key names, and the widget reads keys, not
    positions.
    """

    cmd: str
    payload: dict[str, Any] = field(default_factory=dict)

    def to_wire(self) -> dict[str, Any]:
        return {
            "type": AVATAR_MESSAGE_TYPE,
            "cmd": self.cmd,
            **self.payload,
        }

    # ─── Builders ───────────────────────────────────────────────────────

    @classmethod
    def claim(cls, state: AvatarClaim | None) -> AvatarMessage:
        """Set or clear a durable lower-priority server claim."""
        return cls(cmd="claim", payload={"state": None if state is None else str(state)})

    @classmethod
    def action(cls, action: AvatarAction | str) -> AvatarMessage:
        """Start a self-completing authored face and/or hand action."""
        return cls(cmd="action", payload={"id": str(action)})

    @classmethod
    def cues(
        cls,
        *,
        ctx: str,
        from_ms: int,
        cues: list[dict[str, Any]],
        final: bool = False,
    ) -> AvatarMessage:
        """A viseme chunk. `from_ms` means "discard queued cues at or after this
        offset, then append" — that splice is how the accurate leg replaces the
        fast leg's not-yet-played tail without the widget seeing a seam."""
        return cls(
            cmd="cues",
            payload={"ctx": ctx, "from_ms": from_ms, "cues": cues, "final": final},
        )
