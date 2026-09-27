"""Driving a browser talking-head avatar from a pipecat pipeline.

**Deprecated.** 0.4.1 is the last release; see the README.

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
of your own to say something the pipeline cannot infer — that a long tool call is
`WORKING` rather than `THINKING`, or that an acknowledgement is due. See
`frames.py`.
"""

import warnings

# Before the imports, so a consumer sees it even if one of them fails.
warnings.warn(
    "voqalize-avatar is deprecated and 0.4.1 is its last release. The Voqalize "
    "avatar is now driven by the Voqalize platform and mounted with "
    "@voqalize/avatar on npm; see https://pypi.org/project/voqalize-avatar/",
    DeprecationWarning,
    stacklevel=2,
)

from .frames import AvatarControlFrame  # noqa: E402
from .messages import (  # noqa: E402
    AVATAR_MESSAGE_TYPE,
    AvatarAction,
    AvatarMessage,
    AvatarState,
)
from .processor import AvatarProcessor  # noqa: E402

__all__ = [
    "AVATAR_MESSAGE_TYPE",
    "AvatarAction",
    "AvatarControlFrame",
    "AvatarMessage",
    "AvatarProcessor",
    "AvatarState",
]
