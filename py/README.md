# voqalize-avatar

The pipecat half of [**voqalize/avatar**](https://github.com/voqalize/avatar) —
a 2-D talking head for AI voice calls that renders in the browser, not in a
video track.

The widget is a state machine wearing a face: it renders a state enum, an
emotion, a gaze target, interjection and hand-gesture ids, and a stream of timed
viseme letters, and it decides none of them. This package is the half that decides. It reads
your pipeline's frames, infers what the avatar should be doing, and pushes the
result to the client as RTVI server-messages over the data channel you already
have.

There is no video track, no per-minute avatar vendor, and no second media path.
The face is dependency-free JavaScript on the other end — about 75 KB gzipped
for the widget plus the one rig you mount.

```
pip install voqalize-avatar
```

The browser half is [`@voqalize/avatar`](https://www.npmjs.com/package/@voqalize/avatar).

## Drop it in

`AvatarProcessor` goes between your TTS service and the transport's output —
the seat where it can see the audio that is about to be spoken.

```python
from voqalize_avatar import AvatarProcessor, AvatarStateMachine

avatar = AvatarProcessor(AvatarStateMachine())

pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),
    llm,
    tts,
    avatar,                      # <-- here
    transport.output(),
    context_aggregator.assistant(),
])
```

That is the whole of tier 1, and it needs no application code at all. From
stock pipecat frames the state machine delivers `IDLE`, `LISTENING`,
`THINKING`, `SPEAKING`, `TAKING_FLOOR`, `WAITING_FOR_USER`, `YIELDED`,
`DEGRADED` and `OFFLINE`, plus the turn-clock anchor the client splices cues
onto and the user-speaking truth the listening engine times backchannels off.

## Mouth shapes

Lipsync is the headline feature, and it is opt-in because it needs a native
aligner — the [`avatarsync`](https://github.com/voqalize/avatar/tree/main/native/avatarsync)
fork of [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync),
which emits the A–H+X mouth-shape alphabet the wire format is built on.

```python
from voqalize_avatar.wiring import attach_tts_hooks, build_viseme_engine

engine = build_viseme_engine(avatar, sample_rate=24000, avatarsync="/opt/avatarsync")
attach_tts_hooks(tts, engine)
```

`avatarsync` is the directory your deploy unpacked the artifact into —
`bin/<platform>/avatarsync`, `res/`, `data/phone_weights.json`. It is the entire
configuration surface of the native half, and it is an argument: **this library
reads no environment variables.** Pass `RhubarbPaths.discover()` in a source
checkout where the artifact sits beside the Python, or a `RhubarbPaths` directly
for a layout that is neither. Omit it and you get the state channel alone.

`build_viseme_engine` **never raises**. A missing binary is an ordinary
condition: it logs once, returns `None`, and the session runs state-channel
only — the widget falls back to its own WebAudio amplitude lipsync, which is
worse but not broken. So you can land states, gaze and interjections today and
turn visemes on when the binary is in your image.

The engine runs three legs and the client splices between them: a **fast** leg
that predicts the timeline from text before the audio exists (~0.4 ms), an
**accurate** leg that recognises phones from the rendered PCM (~15 ms), and an
**early-prefix** leg for the first sentence, where latency is most visible.

## Saying what the pipeline cannot infer

Some states need to know what your application is doing — `TYPING`,
`SEARCHING_SCREEN`, `CANT_HEAR`, a deliberate interjection, a composed
`perform()` timeline. No amount of frame-watching infers those correctly, and a
library that guessed would nod at the wrong moment. Two seams, in order of
reach for:

**Push an `AvatarControlFrame`** from anywhere in your pipeline:

```python
from voqalize_avatar import AvatarControlFrame, AvatarMessage, Interjection

await self.push_frame(AvatarControlFrame(message=AvatarMessage.interject(Interjection.MM_HMM)))
```

Hand gestures ride the same seam and are never inferred — a hand in frame is an
application's decision:

```python
from voqalize_avatar import HandGesture

await self.push_frame(AvatarControlFrame(message=AvatarMessage.gesture(HandGesture.HI)))
```

**Or subclass `AvatarStateMachine`** when your application's frames are simply
its own spelling of something the library already models — an LLM that runs out
of process, say, whose tool calls never appear as pipecat function-call frames:

```python
class MyStateMachine(AvatarStateMachine):
    def on_frame(self, frame):
        if isinstance(frame, MyToolStartedFrame):
            return self.tool_started(frame.call_id, frame.name)
        if isinstance(frame, MyToolResultFrame):
            return self.tool_finished(frame.call_id)
        return super().on_frame(frame)
```

`tool_started` / `tool_finished` are public for exactly this: you inherit the
dedup, the parallel-call hold and the `tool_states` lookup rather than
re-implementing them approximately.

One convenience covers the most common case with no code at all —
`AvatarProcessor(AvatarStateMachine(tool_states={"search_web": AvatarState.SEARCHING_SCREEN}))`
maps a function name straight to a state, driven by stock frames.

## What this package will not do

It never decides what the agent says or when. The server is the source of truth
and the client only looks right while rendering it; a heuristic here that
guessed at call *content* would be a bug, not a feature. See
[docs/contract-protocol.md](https://github.com/voqalize/avatar/blob/main/docs/contract-protocol.md),
which is binding for both halves.

## Compatibility

`pipecat-ai>=1.4,<2`, Python 3.12+. The floor is where
`FunctionCallsStartedFrame` and `UserTurnInferenceCompletedFrame` exist; the
test suite runs at the floor as well as at the resolved version, so "we support
1.4" is a claim something actually checks. Base pipecat only — no transport,
STT or TTS extras, because this package sits in somebody else's pipeline and
must not have an opinion about which services they chose.

## License

AGPL-3.0-only. `LICENSE` here is a copy of the repository's, kept beside the
package because a wheel carries its own license file. Commercial licensing:
open an issue.
