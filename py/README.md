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
from voqalize_avatar import AvatarProcessor

pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),
    llm,
    tts,
    AvatarProcessor(),           # <-- here
    transport.output(),
    context_aggregator.assistant(),
])
```

No arguments, no binaries to install, no environment variables — that is the
whole integration, and it needs no other application code. From
stock pipecat frames the state machine delivers `IDLE`, `LISTENING`,
`THINKING`, `SPEAKING`, `TAKING_FLOOR`, `WAITING_FOR_USER`, `YIELDED`,
`DEGRADED` and `OFFLINE`, plus the turn-clock anchor the client splices cues
onto and the user-speaking truth the listening engine times backchannels off.

## Mouth shapes

Lipsync is the headline feature, and there is nothing to wire up: the processor
starts its viseme engine when `StartFrame` arrives, at the sample rate that
frame declares, and drives it from the same karaoke frames pipecat already
pushes for word-level captions.

The wheel carries its own aligner — [`avatarsync`](https://github.com/voqalize/avatar/tree/main/native/avatarsync),
our fork of [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync),
which emits the A–H+X mouth-shape alphabet the wire format is built on — along
with the 56 MB acoustic model it needs. That is why the wheel is ~44 MB and why
it is platform-specific. **No path, no environment variable, no separate
artifact to ship into your image.**

| platform | wheel |
|---|---|
| Linux x86-64 / aarch64 | `manylinux_2_25` — RHEL 8+, Debian 10+, Ubuntu 18.04+ |
| macOS arm64 | `macosx_11_0_arm64` — macOS 11+ |

Intel macOS is not on that list, and the reason is upstream: `pipecat-ai`
requires `onnxruntime`, which publishes no macOS x86-64 wheel, so nothing that
depends on pipecat installs there at all.

Anything else installs the sdist, which carries no binary. So does an explicit
`--no-binary`. Both are fine, and the two APIs differ here on purpose. The
internal one, `build_viseme_engine()`, is a library call and **fails fast**: it
raises `RhubarbUnavailableError` naming the paths it looked in. `AvatarProcessor`
is the layer that decides a missing aligner is survivable — it catches, logs
once, and runs the session state-channel only. The face still listens, thinks,
claims the floor and yields it; its mouth does not move while it speaks. Worse,
not broken.

A source checkout of this repo is found by walking up to `native/avatarsync`, so
the tests and the demo run against a locally built binary with no configuration
either.

The engine runs three legs and the client splices between them: a **fast** leg
that predicts the timeline from text before the audio exists (~0.4 ms), an
**accurate** leg that recognises phones from the rendered PCM (~15 ms), and an
**early-prefix** leg for the first sentence, where latency is most visible.

## Saying what the pipeline cannot infer

Some states need to know what your application is doing — `TYPING`,
`SEARCHING_SCREEN`, `CANT_HEAR`, a deliberate interjection, a hand gesture. No
amount of frame-watching infers those correctly, and a
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

**Or subclass `AvatarStateMachine`** (from `voqalize_avatar.state_machine`) when
your application's frames are simply its own spelling of something the library already models — an LLM that runs out
of process, say, whose tool calls never appear as pipecat function-call frames:

```python
from voqalize_avatar import AvatarProcessor
from voqalize_avatar.state_machine import AvatarStateMachine

class MyStateMachine(AvatarStateMachine):
    def on_frame(self, frame):
        if isinstance(frame, MyToolStartedFrame):
            return self.tool_started(frame.call_id)
        if isinstance(frame, MyToolResultFrame):
            return self.tool_finished(frame.call_id)
        return super().on_frame(frame)

class MyAvatarProcessor(AvatarProcessor):
    STATE_MACHINE = MyStateMachine
```

`STATE_MACHINE` is a class attribute rather than a constructor argument
deliberately: the front door takes no arguments and must keep taking none, and a
second door that costs a `class` statement is not one you walk through by
accident.

`tool_started` / `tool_finished` are public for exactly this: you inherit the
call-id dedup and the parallel-call hold — a turn with three tools settles on one
`THINKING` instead of flickering — rather than re-implementing them
approximately.

A tool call shows `THINKING`, and only that. A `tool_states={"search_web": ...}`
map existed and was removed in 0.2 — an application that knows its tool is
searching says so in one `AvatarControlFrame`. See
[docs/removed.md](https://github.com/voqalize/avatar/blob/main/docs/removed.md).

### If your TTS pads its sentences

The one number the frame stream cannot supply. Some services append a fixed tail
of silence to every sentence; those bytes are indistinguishable from a speaker
pausing, so the engine cannot find them and a byte count reads as a longer
sentence than was spoken. The error is *cumulative* — every sentence after the
first starts further past where the mouth actually is.

```python
from voqalize_avatar import AvatarProcessor
from voqalize_avatar.visemes import INTER_SENTENCE_PAD_MS   # 250, for the fitted service

class MyAvatarProcessor(AvatarProcessor):
    PAD_MS = INTER_SENTENCE_PAD_MS
```

Zero — the default — is right for most services. Measure your own once:
synthesize a short sentence and look at the trailing silence.

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
