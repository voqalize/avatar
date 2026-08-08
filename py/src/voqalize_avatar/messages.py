"""The avatar wire vocabulary — the exact enum names the browser widget accepts.

Every name in this module is the widget's, copied from its binding contract
(`docs/contract-protocol.md` in the avatar repo: `STATE_NAMES`,
`INTERJECTION_IDS`, `EMOTION_NAMES`, `GAZE_NAMES`). They are not labels we may
rename to taste — the widget *throws* on an unknown state or interjection id,
and silently falls back to `neutral`/`USER` on an unknown emotion or gaze, which
is worse: a typo there is invisible on screen.

Everything travels as one RTVI `server-message` shape:

    {"type": "avatar", "cmd": "state", "name": "LISTENING"}

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


class AvatarState(StrEnum):
    """A *condition* the avatar holds until replaced — never an event.

    The whole vocabulary lives here, not just the part `AvatarStateMachine`
    infers. Most of these states describe something only the application knows
    it is doing (`TYPING`, `SEARCHING_SCREEN`, `DISTRACTED`), and the way to
    reach them is an `AvatarControlFrame` from your own processor — see
    `frames.py`.
    """

    IDLE = "IDLE"
    LISTENING = "LISTENING"
    THINKING = "THINKING"
    SPEAKING = "SPEAKING"
    REVIEWING_SCREEN = "REVIEWING_SCREEN"
    WAITING_FOR_USER = "WAITING_FOR_USER"
    CANT_HEAR = "CANT_HEAR"
    TYPING = "TYPING"
    TYPING_CHAT = "TYPING_CHAT"
    DISTRACTED = "DISTRACTED"
    SEARCHING_SCREEN = "SEARCHING_SCREEN"
    TAKING_FLOOR = "TAKING_FLOOR"
    WANTS_IN = "WANTS_IN"
    YIELDED = "YIELDED"
    DEGRADED = "DEGRADED"
    OFFLINE = "OFFLINE"


class Interjection(StrEnum):
    """One-shot gesture clips. Events, not conditions — always re-sent.

    Three are **server-sent only** and must never be fired autonomously by the
    client: `BLINK_LONG` (it measurably shortens the user's next answer) and
    both head shakes (an agent must not disagree by accident). The state machine
    sends none of those three — only the two floor-management clips — so if one
    of them appears on the wire, an application asked for it.
    """

    NOD_SMALL = "NOD_SMALL"
    NOD_SLOW = "NOD_SLOW"
    NOD_UP = "NOD_UP"
    BROW_ACK = "BROW_ACK"
    HEAD_SHAKE = "HEAD_SHAKE"
    HEAD_SHAKE_SOFT = "HEAD_SHAKE_SOFT"
    BLINK_LONG = "BLINK_LONG"
    CLAIM_FLOOR = "CLAIM_FLOOR"
    YIELD_FLOOR = "YIELD_FLOOR"
    RAISE_HAND = "RAISE_HAND"
    WAVE = "WAVE"
    THUMBS_UP = "THUMBS_UP"
    SHRUG = "SHRUG"
    GO_ON_ARM = "GO_ON_ARM"
    MM_HMM = "MM_HMM"
    OKAY = "OKAY"
    YES = "YES"
    SURE = "SURE"
    I_SEE = "I_SEE"
    RIGHT = "RIGHT"
    GO_ON = "GO_ON"
    ONE_MOMENT = "ONE_MOMENT"
    SORRY = "SORRY"
    HMM = "HMM"
    GOT_IT = "GOT_IT"
    TAKE_YOUR_TIME = "TAKE_YOUR_TIME"


class HandGesture(StrEnum):
    """A hand at the frame edge, plus the face half that goes with it.

    Deliberately a separate enum from `Interjection`, not extra members of it:
    `Interjection.WAVE` is the face alone and stays that way, so a widget
    upgrade never grows a hand a backend did not ask for. The widget fires the
    face half itself — send `gesture(HI)`, not `gesture(HI)` *and*
    `interject(WAVE)`.

    Nothing here is autonomous, and the state machine sends none of them: a
    hand in frame is an application's decision.
    """

    HI = "HI"
    BYE = "BYE"
    THUMBS_UP = "THUMBS_UP"
    ONE_MOMENT = "ONE_MOMENT"


class Emotion(StrEnum):
    """Affect, a separate axis from state so the enums don't multiply."""

    NEUTRAL = "neutral"
    WARM = "warm"
    CURIOUS = "curious"
    CONCERNED = "concerned"
    ENCOURAGING = "encouraging"
    THOUGHTFUL = "thoughtful"


class Gaze(StrEnum):
    """Semantic directions; the client does the oculomotor work."""

    USER = "USER"
    USER_EAR = "USER_EAR"
    SCREEN_CENTER = "SCREEN_CENTER"
    SCREEN_LEFT = "SCREEN_LEFT"
    SCREEN_RIGHT = "SCREEN_RIGHT"
    SCREEN_TOP = "SCREEN_TOP"
    SCREEN_BOTTOM = "SCREEN_BOTTOM"
    SCREEN_WORK = "SCREEN_WORK"
    NOTES = "NOTES"
    AWAY_THINKING = "AWAY_THINKING"
    AWAY_RIGHT = "AWAY_RIGHT"
    AWAY_DOWN = "AWAY_DOWN"


class SpeechEvent(StrEnum):
    """`start` is the client's t=0 anchor for the turn's cue clock."""

    START = "start"
    STOP = "stop"


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
    def state(
        cls,
        name: AvatarState,
        *,
        emotion: Emotion | None = None,
        gaze: Gaze | None = None,
    ) -> AvatarMessage:
        payload: dict[str, Any] = {"name": str(name)}
        # Omitted, not null: every state already bundles a default emotion and
        # gaze, and sending an explicit one overrides the bundle. Silence means
        # "use what the state is for".
        if emotion is not None:
            payload["emotion"] = str(emotion)
        if gaze is not None:
            payload["gaze"] = str(gaze)
        return cls(cmd="state", payload=payload)

    @classmethod
    def interject(cls, clip: Interjection) -> AvatarMessage:
        return cls(cmd="interject", payload={"id": str(clip)})

    @classmethod
    def gesture(cls, hand: HandGesture) -> AvatarMessage:
        """A hand gesture. The widget plays the hand *and* its face half.

        Degrades on its own: a widget mounted with `hand: false` — a face drawn
        in another idiom, a tile too small to spend the pixels — plays the face
        half alone, so a backend never has to know which it is talking to.
        """
        return cls(cmd="gesture", payload={"id": str(hand)})

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

    @classmethod
    def speech(cls, event: SpeechEvent, *, ctx: str) -> AvatarMessage:
        return cls(cmd="speech", payload={"event": str(event), "ctx": ctx})

    @classmethod
    def user(cls, *, speaking: bool) -> AvatarMessage:
        """The server endpointer's turn truth, which wins over the client's own
        level VAD — the input side of the listening engine, never the mouth."""
        return cls(cmd="user", payload={"speaking": speaking})
