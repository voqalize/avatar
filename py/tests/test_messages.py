"""The wire vocabulary, locked.

The widget *throws* on an unknown state or interjection id, and — worse —
silently falls back to `neutral`/`USER` on an unknown emotion or gaze, so a typo
there is invisible on screen and costs a debugging session. These lists are
transcribed from the avatar repo's binding contract (`docs/contract-protocol.md`,
tables `STATE_NAMES`, `INTERJECTION_IDS`, `EMOTION_NAMES`, `GAZE_NAMES`). They
are duplication on purpose: the two repos deploy separately, so the only place
the vocabularies can be compared is a test that states both.

If one of these fails, the fix is a conversation with the widget, not an edit
here.
"""

from __future__ import annotations

import json

from voqalize_avatar import AvatarMessage, AvatarState, Emotion, Gaze, Interjection
from voqalize_avatar.messages import Hint, SpeechEvent

STATE_NAMES = {
    "IDLE",
    "LISTENING",
    "THINKING",
    "SPEAKING",
    "REVIEWING_SCREEN",
    "WAITING_FOR_USER",
    "CANT_HEAR",
    "TYPING",
    "TYPING_CHAT",
    "DISTRACTED",
    "SEARCHING_SCREEN",
    "TAKING_FLOOR",
    "WANTS_IN",
    "YIELDED",
    "DEGRADED",
    "OFFLINE",
}

INTERJECTION_IDS = {
    "NOD_SMALL",
    "NOD_SLOW",
    "NOD_UP",
    "BROW_ACK",
    "HEAD_SHAKE",
    "HEAD_SHAKE_SOFT",
    "BLINK_LONG",
    "CLAIM_FLOOR",
    "YIELD_FLOOR",
    "RAISE_HAND",
    "WAVE",
    "THUMBS_UP",
    "SHRUG",
    "GO_ON_ARM",
    "MM_HMM",
    "OKAY",
    "YES",
    "SURE",
    "I_SEE",
    "RIGHT",
    "GO_ON",
    "ONE_MOMENT",
    "SORRY",
    "HMM",
    "GOT_IT",
    "TAKE_YOUR_TIME",
}

EMOTION_NAMES = {"neutral", "warm", "curious", "concerned", "encouraging", "thoughtful"}

GAZE_NAMES = {
    "USER",
    "USER_EAR",
    "SCREEN_CENTER",
    "SCREEN_LEFT",
    "SCREEN_RIGHT",
    "SCREEN_TOP",
    "SCREEN_BOTTOM",
    "SCREEN_WORK",
    "NOTES",
    "AWAY_THINKING",
    "AWAY_DOWN",
    "AWAY_RIGHT",
}


def test_the_state_vocabulary_is_the_widgets() -> None:
    assert {s.value for s in AvatarState} == STATE_NAMES


def test_the_interjection_vocabulary_is_the_widgets() -> None:
    assert {i.value for i in Interjection} == INTERJECTION_IDS


def test_the_emotion_vocabulary_is_the_widgets() -> None:
    """Lowercase, unlike everything else on this wire — because it is lowercase
    in the widget."""
    assert {e.value for e in Emotion} == EMOTION_NAMES


def test_the_gaze_vocabulary_is_the_widgets() -> None:
    assert {g.value for g in Gaze} == GAZE_NAMES


# ─── The envelope ─────────────────────────────────────────────────────────────


def test_every_builder_produces_the_same_envelope() -> None:
    built = [
        AvatarMessage.state(AvatarState.LISTENING),
        AvatarMessage.interject(Interjection.CLAIM_FLOOR),
        AvatarMessage.perform([{"t": 0, "do": "gaze", "name": "NOTES"}], ctx="1.1"),
        AvatarMessage.cues(ctx="1.1", from_ms=0, cues=[], final=False),
        AvatarMessage.speech(SpeechEvent.START, ctx="1.1"),
        AvatarMessage.user(speaking=True),
        AvatarMessage.hint(Hint.EAGER_EOT),
    ]
    for message in built:
        wire = message.to_wire()
        assert wire["type"] == "avatar"
        assert wire["v"] == 1
        assert wire["cmd"] == message.cmd


def test_an_unadorned_state_omits_emotion_and_gaze() -> None:
    """Omitted, not null: every state already bundles a default emotion and
    gaze, and an explicit key overrides the bundle. `None` would override it
    with nothing."""
    assert AvatarMessage.state(AvatarState.THINKING).to_wire() == {
        "type": "avatar",
        "v": 1,
        "cmd": "state",
        "name": "THINKING",
    }
    assert AvatarMessage.state(
        AvatarState.THINKING, emotion=Emotion.THOUGHTFUL, gaze=Gaze.AWAY_THINKING
    ).to_wire() == {
        "type": "avatar",
        "v": 1,
        "cmd": "state",
        "name": "THINKING",
        "emotion": "thoughtful",
        "gaze": "AWAY_THINKING",
    }


def test_the_wire_form_is_plain_json() -> None:
    """It rides an RTVI `server-message`, which is serialized as-is. An enum
    member that survives to `json.dumps` is a `str` subclass today and a
    `TypeError` the day the enum changes base."""
    wire = AvatarMessage.state(AvatarState.LISTENING, emotion=Emotion.WARM).to_wire()
    assert json.loads(json.dumps(wire)) == wire
    assert type(wire["name"]) is str
    assert type(wire["emotion"]) is str
