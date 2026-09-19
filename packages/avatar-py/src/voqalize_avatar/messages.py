"""The small avatar wire vocabulary shared with the browser.

Everything travels as one RTVI `server-message` shape:

    {"type": "avatar", "cmd": "state", "state": "THINKING"}

`type` is the whole envelope. There is no version field: RTVI carries the payload
opaquely, so a version would have been ours to invent and ours to check, and
neither end ever checked it. The compatibility rule it stood for is real and
survives it — the client ignores a `cmd` it does not know, so adding a verb is
backward compatible and changing the meaning of one is not. The two packages
release independently, so that rule is what keeps the ends together
(`RELEASING.md` § Compatibility).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

AVATAR_MESSAGE_TYPE = "avatar"


class AvatarState(StrEnum):
    """Durable server intent below Pipecat's factual speech states.

    Three of the nine, and the only three a server may send: the other six are
    Pipecat facts the browser already holds, and a server spelling of a fact
    would be a second, lower-authority copy of it.

    Ordered most to least urgent, which is also the order the state machine
    resolves them in when more than one condition holds at once.
    """

    CANT_HEAR = "CANT_HEAR"
    THINKING = "THINKING"
    WORKING = "WORKING"


class AvatarAction(StrEnum):
    """The two actions every avatar must answer to.

    The wire's action vocabulary is **open** — an id is a name resolved against
    whatever is mounted, and an unknown one is ignored — so this enum is not the
    vocabulary. It is the part of it a server may send without knowing which
    face is on the other end, which is why `AvatarMessage.action` accepts a
    plain string too.

    `ACKNOWLEDGE` is the whole backchannel family in one word: a receipt, a
    continuer nod, a realisation and an empathy beat are four *shapes* of
    acknowledging, and which one a face makes is a rendering decision. The
    server's job is to know that an acknowledgement is due.
    """

    ACKNOWLEDGE = "ACKNOWLEDGE"
    RESPONSE_INTERRUPTED = "RESPONSE_INTERRUPTED"


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
    def state(cls, state: AvatarState | None) -> AvatarMessage:
        """Set or clear the durable lower-priority server state."""
        return cls(cmd="state", payload={"state": None if state is None else str(state)})

    @classmethod
    def action(cls, action: AvatarAction | str) -> AvatarMessage:
        """Start a self-completing authored face and/or hand action.

        A plain string is deliberately allowed: beyond the two core ids the
        vocabulary is the mounted avatar's own, and a server that knows which
        face is on the other end may name one of its motions. A face without
        that name ignores the message.
        """
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
