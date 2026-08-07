"""Driving a browser talking-head avatar from a pipecat pipeline.

The widget is a state machine wearing a face — it renders a state enum, an
emotion enum, a gaze enum, interjection and hand-gesture ids, and a stream of
timed viseme letters, and decides none of them. This package is the half that
decides.

- `messages` — the wire vocabulary, verbatim from the widget's contract
  (`docs/contract-protocol.md`).
- `state_machine` — frames in, messages out; pure, synchronous, testable.
- `frames` — `AvatarControlFrame`, the one frame an application pushes to say
  something the pipeline cannot infer.
- `processor` — the pipeline seat between `tts` and `transport.output()`.
- `visemes` / `avatarsync` / `durations` — the mouth-shape pipeline, feeding
  `AvatarProcessor.push_cues`.
- `wiring` — the one function that introduces the two halves to each other.

The barrel below re-exports the state channel only. The viseme modules are
imported by name (`from voqalize_avatar.visemes import VisemeEngine`) and stay
out of the barrel deliberately: they resolve the native `avatarsync` binary, and
importing this package must never drag the native runtime in. A session with
visemes switched off should not pay for a subprocess pool it will not use.
"""

from .frames import AvatarControlFrame
from .messages import (
    AVATAR_MESSAGE_TYPE,
    AVATAR_PROTOCOL_VERSION,
    AvatarMessage,
    AvatarState,
    Emotion,
    Gaze,
    HandGesture,
    Hint,
    Interjection,
    SpeechEvent,
)
from .processor import AvatarProcessor
from .state_machine import AvatarStateMachine

__all__ = [
    "AVATAR_MESSAGE_TYPE",
    "AVATAR_PROTOCOL_VERSION",
    "AvatarControlFrame",
    "AvatarMessage",
    "AvatarProcessor",
    "AvatarState",
    "AvatarStateMachine",
    "Emotion",
    "Gaze",
    "HandGesture",
    "Hint",
    "Interjection",
    "SpeechEvent",
]
