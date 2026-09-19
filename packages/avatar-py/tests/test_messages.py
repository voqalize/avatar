"""The wire vocabulary, locked.

The action vocabulary is open — the widget ignores an id it has no motion for —
which makes a typo in a *core* id the expensive kind of mistake: nothing throws,
nothing logs, and the face simply never acknowledges. So the two core ids are
transcribed here from the avatar repo's wire contract (`docs/contract-wire.md`),
as are the three states, which the widget does still reject outright. It is
duplication on purpose: the two repos deploy separately, so the only place the
vocabularies can be compared is a test that states both.

If one of these fails, the fix is a conversation with the widget, not an edit
here.
"""

from __future__ import annotations

import json

from voqalize_avatar import AvatarAction, AvatarMessage, AvatarState

#: Every action a server may send without knowing which face is mounted. Not
#: the vocabulary — that is open and belongs to the avatar.
CORE_ACTION_IDS = {"ACKNOWLEDGE", "RESPONSE_INTERRUPTED"}
#: Every state a server may send at all. The other six of the nine are Pipecat
#: facts the browser holds, and the widget rejects them from a server.
SERVER_STATES = {"CANT_HEAR", "THINKING", "WORKING"}


def test_the_core_vocabularies_are_the_two_and_the_three() -> None:
    assert {action.value for action in AvatarAction} == CORE_ACTION_IDS
    assert {state.value for state in AvatarState} == SERVER_STATES


# ─── The envelope ─────────────────────────────────────────────────────────────


def test_every_builder_produces_the_same_envelope() -> None:
    built = [
        AvatarMessage.state(AvatarState.THINKING),
        AvatarMessage.action(AvatarAction.ACKNOWLEDGE),
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
    wire = AvatarMessage.action(AvatarAction.ACKNOWLEDGE).to_wire()
    assert json.loads(json.dumps(wire)) == wire
    assert type(wire["id"]) is str


def test_state_can_be_cleared_and_actions_are_one_small_uniform_verb() -> None:
    assert AvatarMessage.state(AvatarState.WORKING).to_wire() == {
        "type": "avatar", "cmd": "state", "state": "WORKING",
    }
    assert AvatarMessage.state(None).to_wire() == {
        "type": "avatar", "cmd": "state", "state": None,
    }
    assert AvatarMessage.action(AvatarAction.ACKNOWLEDGE).to_wire() == {
        "type": "avatar", "cmd": "action", "id": "ACKNOWLEDGE",
    }
    # An avatar's own motion rides the same command. Nothing here knows the
    # name; that is the mounted face's business and the point of the change.
    assert AvatarMessage.action("NOD_ASSESS").to_wire() == {
        "type": "avatar", "cmd": "action", "id": "NOD_ASSESS",
    }
