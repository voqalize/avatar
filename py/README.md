# voqalize-avatar

The pipecat half of [**voqalize/avatar**](https://github.com/voqalize/avatar) —
a 2-D talking head for AI voice calls that renders in the browser, not in a
video track.

The avatar is lip-synced to your TTS audio and state aware: it knows when it has
been interrupted, when the user is talking versus idle, when a tool call started
and stopped. This package is the half that decides. It reads your pipeline's
frames, infers what the avatar should be doing, and pushes the result to the
client as RTVI server-messages over the data channel you already have.

No video track, no per-minute avatar vendor, no second media path. The face is
dependency-free JavaScript on the other end —
[`@voqalize/avatar`](https://www.npmjs.com/package/@voqalize/avatar), about
75 KB gzipped plus the one rig you mount.

```
pip install voqalize-avatar
```

## Drop it in

`AvatarProcessor` goes between your TTS service and the transport's output —
the seat where it can see the audio that is about to be spoken, at generation
speed.

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
whole integration, and it needs no other application code. Pipecat's JavaScript
client projects the standard lifecycle locally; this processor supplies the
TTS-context-correlated viseme cues it cannot reconstruct, plus explicit intent
you push yourself. Why this seat and not an observer, and why the frames go
*downstream*: the module docstring in `processor.py`.

## Mouth shapes

Lipsync is the headline feature and there is nothing to wire up. The processor
starts its viseme engine on `StartFrame`, at the sample rate that frame
declares, and drives it from the same karaoke frames pipecat already pushes for
word-level captions.

The wheel carries its own aligner —
[`avatarsync`](https://github.com/voqalize/avatar/tree/main/native/avatarsync),
our fork of [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync),
emitting the A–H+X mouth-shape alphabet the wire format is built on — along with
the 56 MB acoustic model it needs. That is why the wheel is ~44 MB and
platform-specific. **No path, no environment variable, no separate artifact to
ship into your image.**

Two legs, and the **server** splices between them. The **fast** leg predicts the
whole timeline from the sentence's text before any audio exists (~0.15 ms, on
the event loop) so the mouth is already moving when the first sample plays. The
**accurate** leg then recognises phones from the rendered PCM as it streams, off
the loop, and overwrites the prediction from the point it has reached. The
client never chooses: a `cues` message carries `from_ms`, and everything queued
at or after it is discarded. The reasoning and the constants are in
`visemes.py`, next to the numbers they explain.

| platform | wheel |
|---|---|
| Linux x86-64 / aarch64 | `manylinux_2_25` — RHEL 8+, Debian 10+, Ubuntu 18.04+ |
| macOS arm64 | `macosx_11_0_arm64` — macOS 11+ |

Intel macOS is absent for an upstream reason: `pipecat-ai` requires
`onnxruntime`, which publishes no macOS x86-64 wheel, so nothing depending on
pipecat installs there at all.

Anything else installs the sdist, which carries no binary. So does an explicit
`--no-binary`. Both are fine, and **an install with no aligner is an ordinary
condition rather than a failure**: `AvatarProcessor` catches, logs once, and
runs the session state-channel only. The face still listens, thinks, claims the
floor and yields it; its mouth does not move while it speaks. Worse, not broken.
(The internal `build_viseme_engine()` fails fast instead, raising
`AvatarsyncUnavailableError` — a caller who asked for an engine and silently did
not get one has been lied to.)

A source checkout of the repo is found by walking up to `native/avatarsync`, so
the tests and the demo run against a locally built library with no configuration
either. `voqalize-avatar info` says which one was found and proves it answers.

## Saying what the pipeline cannot infer

Some behavior needs application knowledge — a deliberate acknowledgement, a hand
gesture, a tool call that should read as *reviewing the screen* rather than
*thinking*. No amount of frame-watching infers those correctly, and a library
that guessed would nod at the wrong moment.

**Push an `AvatarControlFrame`** from anywhere in your pipeline:

```python
from voqalize_avatar import AvatarAction, AvatarControlFrame, AvatarMessage

await self.push_frame(AvatarControlFrame(message=AvatarMessage.action(AvatarAction.ACK_RECEIVE)))
await self.push_frame(AvatarControlFrame(message=AvatarMessage.action(AvatarAction.GESTURE_GREET)))
```

**Or subclass `AvatarStateMachine`** (from `voqalize_avatar.state_machine`) when
your application's frames are simply its own spelling of something the library
already models — an LLM running out of process, say, whose tool calls never
appear as pipecat function-call frames:

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
accident. `tool_started` / `tool_finished` are public for exactly this — you
inherit the call-id dedup and the parallel-call hold, so a turn with three tools
settles on one `THINKING` instead of flickering.

These two seams are the whole extension surface. A `tool_states={"search_web":
...}` map existed and was removed in 0.2; an application that knows its tool is
searching says so in one `AvatarControlFrame`
([removed.md](https://github.com/voqalize/avatar/blob/main/docs/removed.md)).

## What this package will not do

It never decides what the agent says or when. Pipecat owns the facts, the server
owns intent, the rig only renders — a heuristic here that guessed at call
*content* would be a bug, not a feature. Binding for both halves:
[contract-protocol.md](https://github.com/voqalize/avatar/blob/main/docs/contract-protocol.md)
and
[pipecat-lifecycle-protocol.md](https://github.com/voqalize/avatar/blob/main/docs/pipecat-lifecycle-protocol.md).

## Compatibility

`pipecat-ai>=1.4,<2`, Python 3.12+. The floor is where
`FunctionCallsStartedFrame` and `UserTurnInferenceCompletedFrame` exist; the
test suite runs at the floor as well as at the resolved version, so "we support
1.4" is a claim something actually checks. Base pipecat only — no transport, STT
or TTS extras, because this package sits in somebody else's pipeline and must
not have an opinion about which services they chose.

## License

AGPL-3.0-only. `LICENSE` here is a copy of the repository's, kept beside the
package because a wheel carries its own license file. Commercial licensing: open
an issue.
