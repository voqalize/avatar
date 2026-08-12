"""The wire vocabulary, locked.

The widget *throws* on an unknown state or interjection id, and — worse —
silently falls back to `neutral`/`USER` on an unknown emotion or gaze, so a typo
there is invisible on screen and costs a debugging session. These lists are
transcribed from the avatar repo's binding contract (`docs/contract-protocol.md`,
`AvatarAction`). It is duplication on purpose: the two repos deploy separately,
so the only place the vocabularies can be compared is a test that states both.

If one of these fails, the fix is a conversation with the widget, not an edit
here.
"""

from __future__ import annotations

import json

from voqalize_avatar import AvatarAction, AvatarClaim, AvatarMessage

ACTION_IDS = {
    "ACK_RECEIVE", "ACK_NOD",
    "RESPONSE_INTERRUPTED",
    "GESTURE_GREET", "GESTURE_GOODBYE", "GESTURE_APPROVE", "GESTURE_WAIT",
}


def test_the_action_vocabulary_is_compact_and_semantic() -> None:
    assert {action.value for action in AvatarAction} == ACTION_IDS


# ─── The envelope ─────────────────────────────────────────────────────────────


def test_every_builder_produces_the_same_envelope() -> None:
    built = [
        AvatarMessage.claim(AvatarClaim.THINKING),
        AvatarMessage.action(AvatarAction.ACK_NOD),
        AvatarMessage.cues(ctx="1.1", from_ms=0, cues=[], final=False),
    ]
    for message in built:
        wire = message.to_wire()
        assert wire["type"] == "avatar"
        assert wire["cmd"] == message.cmd


def test_the_wire_form_is_plain_json() -> None:
    """It rides an RTVI `server-message`, which is serialized as-is. An enum
    member that survives to `json.dumps` is a `str` subclass today and a
    `TypeError` the day the enum changes base."""
    wire = AvatarMessage.action(AvatarAction.ACK_NOD).to_wire()
    assert json.loads(json.dumps(wire)) == wire
    assert type(wire["id"]) is str


def test_claim_can_be_cleared_and_actions_are_one_small_uniform_verb() -> None:
    assert AvatarMessage.claim(AvatarClaim.WORKING).to_wire() == {
        "type": "avatar", "cmd": "claim", "state": "WORKING",
    }
    assert AvatarMessage.claim(None).to_wire() == {
        "type": "avatar", "cmd": "claim", "state": None,
    }
    assert AvatarMessage.action(AvatarAction.ACK_NOD).to_wire() == {
        "type": "avatar", "cmd": "action", "id": "ACK_NOD",
    }
