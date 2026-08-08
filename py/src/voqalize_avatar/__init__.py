"""Driving a browser talking-head avatar from a pipecat pipeline.

The widget is a state machine wearing a face — it renders a state enum, an
emotion enum, a gaze enum, interjection and hand-gesture ids, and a stream of
timed viseme letters, and decides none of them. This package is the half that
decides.

Add the processor between your TTS and your output transport and it works:

    from voqalize_avatar import AvatarProcessor

    pipeline = Pipeline([
        transport.input(), stt, context_aggregator.user(), llm, tts,
        AvatarProcessor(),
        transport.output(),
    ])

No arguments, no binaries to install, no environment variables. States,
lipsync, the floor claim and the failure states are inferred from frames every
pipecat pipeline already produces.

The only other thing to know is `AvatarControlFrame`: push one from a processor
of your own to say something the pipeline cannot infer — `TYPING`,
`SEARCHING_SCREEN`, a deliberate gesture. See `frames.py`.
"""

from .frames import AvatarControlFrame
from .messages import (
    AVATAR_MESSAGE_TYPE,
    AvatarMessage,
    AvatarState,
    Emotion,
    Gaze,
    HandGesture,
    Interjection,
    SpeechEvent,
)
from .processor import AvatarProcessor

__all__ = [
    "AVATAR_MESSAGE_TYPE",
    "AvatarControlFrame",
    "AvatarMessage",
    "AvatarProcessor",
    "AvatarState",
    "Emotion",
    "Gaze",
    "HandGesture",
    "Interjection",
    "SpeechEvent",
]
