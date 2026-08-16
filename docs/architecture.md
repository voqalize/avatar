# Architecture

*For a pipecat developer deciding whether this fits their pipeline. It is the
map of how the pieces relate and why they are cut where they are; the binding
detail lives in the documents this one points at, and each of those is the only
copy of what it owns.*

The avatar is a 2-D talking head that renders in the browser from data-channel
messages. There is no video track, no per-minute avatar vendor and no second
media path — which is the whole reason it is cheap, and also why adopting it
changes nothing about your transport.

Two packages, and they are the two ends of one wire format:

| | | |
|---|---|---|
| `@voqalize/avatar` | npm | the face. `createAvatar({ mount, client })` in the browser. |
| `voqalize-avatar` | PyPI | the pipeline half. `AvatarProcessor()` between your TTS and `transport.output()`. |

They publish in lockstep from one tag, because a version pair that can drift is
a protocol mismatch waiting to be debugged in production
([RELEASING.md](../RELEASING.md)).

## The goal

**Without any customization, most of the avatar works on any pipecat
application.** Not because we enumerated integrations, but because the
behaviour is derived from frames and events a pipecat pipeline already emits:
bot playout, user speech, mute, connection, function calls, LLM response
boundaries, the TTS text and audio going past. Nothing in the design asks the
application to describe itself.

Concretely, the whole integration is two lines and neither takes an argument:

```python
pipeline = Pipeline([..., tts, AvatarProcessor(), transport.output()])
```

```js
const avatar = createAvatar({ mount: el, client: pipecatClient });
```

What that leaves over is small and specific, and it is listed below under
[what costs a line of code](#what-you-get-for-free-and-what-costs-a-line). It is
mostly the class of thing no amount of frame-watching could infer correctly — a
deliberate nod, a greeting, a tool whose calls never enter your pipeline — and
guessing at those would make the face wrong at exactly the moments people are
watching it.

## The five principles

### 1. The avatar is an embodiment of the pipecat client

`createAvatar` takes a live `PipecatClient` and subscribes to it. The avatar
derives as much of its behaviour as it can directly from that client's standard
events, rather than being told over a side channel, because two spellings of
one fact is two things that can disagree — and when they disagree on screen the
face is out of sync with the audio, which is the one defect nobody forgives.
The user-speaking state was once duplicated onto our own wire; it created races
and obscured ownership, and it was removed
([pipecat-lifecycle-protocol.md § What the backend does and does not send](pipecat-lifecycle-protocol.md)).

Two consequences that surprise people, both deliberate:

- **There is no avatar state to read back.** No presence callback, no
  `onPresenceChange`, no `data-avatar-state` attribute. The resolved state is
  what the avatar acts on, not something the host observes. Publishing it would
  make it a second public contract that every avatar implementation then owes
  ([design-avatar-interface.md § Consequences](design-avatar-interface.md)). A
  host that wants a status pill holds the same `PipecatClient` and can subscribe
  to it directly, with its own precedence, for its own chrome.
- **Observed playout is fact; a server message is a candidate.** If bot audio
  is playing, the avatar is speaking and its mouth is viseme-driven, whatever
  the server most recently claimed. The client never decides what the agent is
  *doing* — it has no view of call content and no way to refuse a server
  command — but it does own what it can see for itself.

### 2. States form a hierarchy

A **state** is a durable condition: it holds until the facts change, and it
does not complete on a timer. Exactly one state is effective at any instant,
and it is *not* the last message received — it is the winner of a fixed
precedence ladder.

Roughly, and illustratively only: bot playout outranks user speech, which
outranks connection posture and mute, which outrank the server's claims
(`STRAINING`, then `THINKING`, then `WORKING`), which outrank the client's own
quiet timer falling through to `IDLE`. **The normative ladder — all of its
rungs, in order, with what retires each one — is
[pipecat-lifecycle-protocol.md § Authority model](pipecat-lifecycle-protocol.md),
and that is the only copy.** It exists once in prose and once in code
(`client/src/AvatarClient.ts`); a second normative copy would drift, and this
project has watched that happen.

Two things the ladder is protecting are worth stating here, because they are
why it is a ladder rather than a switch:

- **If bot audio is playing, `SPEAKING` wins and the mouth articulates.** Full
  stop. A claim arriving mid-utterance cannot take the mouth away.
- **`IDLE` is the wrong answer to most of the silence in a call.** Something is
  nearly always happening in it — an endpointer deciding, a context
  aggregating, a model generating, a tool running, a TTS buffering — and a face
  that goes blank across that reads as *disconnected* rather than *busy*. The
  states below the speech pair exist to cover that stretch, each one a latch
  armed by one observation and retired by another
  ([pipecat-lifecycle-protocol.md § The silence problem](pipecat-lifecycle-protocol.md),
  which also records the one heuristic we deliberately do not implement, and
  why).

The vocabulary an avatar implementation receives is nine names, and
[contract-behavior.md](contract-behavior.md) owns that list. A state names what
is happening, never how to draw it: `WORKING` is `WORKING` on the wire whether
your renderer draws it as typing, as a spinner, or as nothing at all.

### 3. Actions are moments; states are durations

An **action** is a finite physical sequence with a start, a bounded timeline
and its own completion — a nod, a receipt, a greeting, a wave. It establishes
no durable state and needs no end message. Actions layer *over* whichever state
is effective, so a nod during speech moves the head while the mouth stays on
the server's viseme track.

The rule that makes them trustworthy: **the renderer never invents one.** Every
acknowledgement, empathy beat and receipt is an explicit `action` message sent
by application or backend code. An avatar that nods on its own is an avatar
that will nod at the wrong moment, and a viewer reads that as the system not
understanding them. Autonomy here is contingent, never decorative — the
renderer's own autonomy stops at physical polish: blending, blink, breath,
small eye motion, sustained posture.

Seven actions are promoted to the wire (`ACK_RECEIVE`, `ACK_NOD`,
`RESPONSE_INTERRUPTED`, `GESTURE_GREET`, `GESTURE_GOODBYE`, `GESTURE_APPROVE`,
`GESTURE_WAIT`). The bundled SVG renderer's internal clip library is larger,
and that is not a broader profile waiting to be exposed: promoting a clip is a
decision about what a *server* may ask any avatar for
([contract-behavior.md](contract-behavior.md) § Action).

### 4. An avatar is a JavaScript contract, not a renderer

```ts
createAvatar({ mount, client, ...implementationOptions }) -> { destroy() }
```

That is the entire public seam, and it is typed: `AvatarFactory<O>` is generic
over the implementation's own options, so a caller passing yours still gets
them checked. At runtime it is duck typing on the top-most layer — an avatar
*is* the API.

Ours happens to be SVG. Nothing about the contract is: a Rive rig, a WebGL
head, a CSS-only mascot and a renderer with no mouth at all are all conforming
avatars. **You add an avatar by publishing a module that exports
`createAvatar`, and importing yours instead of ours.** No registry, no loader,
no plug-in system, no asset resolution — a registry would make us own
resolution, versioning and asset paths for code we have never seen.

There is deliberately **no renderer interface**, and that is a finding rather
than an omission. The bundled rig's 30 pose channels read like the renderer
seam, and an experiment plugged into them: it ended up thresholding mouth
floats back into a viseme letter and reverse-engineering an intent out of brow
values — reconstructing inputs the wire had already carried in plain words. A
renderer that receives `claim`, `action` and `cues` needs none of that, so the
seam sits at the client
([design-avatar-interface.md § Why there is no renderer interface](design-avatar-interface.md)).

What an implementation owes the caller is only that `destroy()` unsubscribes
and leaves the mount as it found it. The obligations that actually matter are
perceptual, and they are in [contract-behavior.md](contract-behavior.md).

### 5. It is built on the pipecat ecosystem, not beside it

The browser half is driven by `@pipecat-ai/client-js` — your instance of it,
which you already have; the package declares it an *optional* peer and imports
its types only, so nothing about the avatar's entry point fails to load without
it. Our own Avatar Studio additionally uses `@pipecat-ai/client-react` and the
voice-ui-kit for its call plumbing, which is the ordinary consumer's position
and deliberately so ([studio/README.md](../studio/README.md)).

The pipeline half is an ordinary pipecat `FrameProcessor`. It sits between the
TTS service and `transport.output()`, which is the seat where it can see the
audio that is about to be spoken, at generation speed. The declared range is
`pipecat-ai>=1.4,<2`, and CI runs the suite at the floor as well as at the
resolved version, so "we support 1.4" is a claim a test checks
([py/README.md § Compatibility](../py/README.md)).

**No transport change is needed.** The obvious-looking move — enabling video
output on the transport — is the integration path for *server-side* video
avatars and is the wrong one here. The client seam is wherever your app already
renders the bot's tile.

## The layers

```text
  YOUR PIPECAT PIPELINE                          THE BROWSER
  ─────────────────────                          ───────────

  transport.input()
   stt / llm / tts                     PipecatClient ── standard RTVI events
        │                                   │          (bot/user speech, mute,
        │  stock frames                     │           connect, error)
        ▼                                   │
  ┌───────────────┐   RTVI server-message   ▼
  │AvatarProcessor│ ───────────────────► AvatarClient ── resolves ONE effective
  │  state machine│    claim / action /    (lifecycle)   state; anchors the cue
  │  viseme legs  │    cues                    │         clock to real playout
  └───────────────┘                            ▼
        │                                 behavior ──── nine states, seven
        ▼                                 (src/behavior.js)  actions
  transport.output()                          │
                                              ▼
                                          renderer ──── ours: mixer → rig → face
                                                        yours: anything at all
```

Read the two columns as two authorities that never negotiate. The left one
observes frames and *proposes*; the right one observes facts and *resolves*.
Only three commands cross the gap, and the envelope is one RTVI
`server-message` shape ([contract-wire.md](contract-wire.md), the one copy):

```json
{ "type": "avatar", "cmd": "claim",  "state": "WORKING" }
{ "type": "avatar", "cmd": "action", "id": "ACK_NOD" }
{ "type": "avatar", "cmd": "cues",   "ctx": "tts-context", "from_ms": 0, "cues": [] }
```

Note what is *not* on that wire: no user-speaking message, no mute message, no
connection message, no effective state. Every one of those is something the
browser already knows first-hand.

Below the client, the layering is our implementation's business and carries no
semver promise. The mixer composes layers in a fixed order and every channel
chases its target with an exponential approach rather than a tween — smoothing
*is* the animation here ([internal-mixer.md](internal-mixer.md)) — and the rig
turns 30 pose channels into one drawing ([internal-rig.md](internal-rig.md)).
An avatar author does not need either. Both are named `internal-*` precisely so
a future renderer does not plug into the wrong seam.

## What you get for free, and what costs a line

**Free** — the two-line integration above, no other application code:

| | comes from |
|---|---|
| `SPEAKING`, `LISTENING` | `PipecatClient` events, browser-side. No backend involvement at all. |
| `MUTED` | pipecat's own mute events, which already reach the browser. It is not a wire command and never was — a claim would be a second, lower-authority spelling of a fact. |
| `OFFLINE`, `DEGRADED` | the client's disconnect and error events. |
| `IDLE` | the client's quiet timer (12 s), only in an established session. |
| `THINKING`, `WORKING`, `STRAINING` | `AvatarProcessor` inferring from stock frames — the end of a user turn, LLM response boundaries, function-call frames, and a grace timer for the turn that produced nothing. These are claims because the frames they need do not all reach the browser. |
| `RESPONSE_INTERRUPTED` | the processor observing a real interruption during bot playout, and sending the action itself. |
| lipsync | `AvatarProcessor`, from the same karaoke frames pipecat already pushes for word-level captions. Two legs, spliced server-side. |
| idle motion, blink, breath, gaze aversion | the renderer, always. |

Two honest asterisks on that table. **Lipsync needs the Python package**, not
merely the browser one: both legs run server-side, the fast leg predicts from
text before audio exists and the accurate leg recognises phones from the
rendered PCM, and the aligner rides inside the wheel. There is no client-side
lipsync to fall back on — `textToCues` in `@voqalize/avatar/internal` is a crude
grapheme guesser fit for previews only. And **an install with no binary is an
ordinary condition, not a failure**: on a platform outside the wheel matrix, or
an sdist install, the processor logs once and runs state-channel only. The
degradation is bounded and it is exactly one thing — the face still listens,
thinks, claims the floor and yields it; its mouth does not move while it speaks
([py/README.md § Mouth shapes](../py/README.md)).

**Costs a line of code**, and each of these is a case the library refuses to
guess at:

| | how |
|---|---|
| a deliberate nod, receipt, greeting, wave | push an `AvatarControlFrame` carrying an action from anywhere in your pipeline. |
| an out-of-process LLM whose tool calls never appear as pipecat function-call frames | subclass `AvatarStateMachine` and translate your own frames in `on_frame`; you inherit the call-id dedup and the parallel-call hold. |
| a richer pose than the nine states — reviewing a screen, searching, typing into a chat | drive the mixer directly through `@voqalize/avatar/internal`, whose state list has exactly one copy, `STATES` in `src/avatar.js`. Not wire vocabulary, on purpose. |
| a backend that is not ours | produce `cues` yourself. Best first: map your TTS's native viseme events; else force-align text against audio; the tables for both are exported from `@voqalize/avatar/internal` ([README.md § TTS to visemes](../README.md)). |
| a different face, or a different rendering technology entirely | pass a `face`, or publish your own `createAvatar`. |

The two backend seams are the whole extension surface, and the choice between
them is not stylistic: a control frame when the signal originates elsewhere in
the pipeline, a subclass when your frames are simply *your spelling* of
something the library already models
([design-library-split.md § 4. Two tiers of state](design-library-split.md)).

## Where authority lives

**Pipecat owns facts, the server owns intent, the rig only renders.** That
precedence is the design, and almost every decision above is a consequence of
it.

```text
Pipecat JavaScript events  -> factual speech, connection posture, cue-clock anchor
avatar server-message      -> visemes, server claims, and explicit actions
avatar renderer            -> composition; never an inferred acknowledgement
```

The failure modes it rules out are specific. A client that decided what the
agent was doing would be free to refuse a server command — a clip-priority
mechanism that would have allowed exactly that was rejected outright. A renderer
that inferred intent from pose values would be reconstructing what the wire
already said. A backend heuristic that read call *content* would be guessing at
the one thing this library has no business knowing: not one state above is a
statement about what was said, only about the flow of frames — which is why they
can all be tested without running a call
([pipecat-lifecycle-protocol.md § Ownership](pipecat-lifecycle-protocol.md)).

## Where to read next

| you want | read |
|---|---|
| the three commands and their fields | [contract-wire.md](contract-wire.md) |
| the precedence ladder, and every latch under it | [pipecat-lifecycle-protocol.md](pipecat-lifecycle-protocol.md) |
| states and actions as an avatar author receives them | [contract-behavior.md](contract-behavior.md) |
| the public interface, and how to ship your own avatar | [design-avatar-interface.md](design-avatar-interface.md) |
| why a library, what each package owns, the repo layout | [design-library-split.md](design-library-split.md) |
| the pipeline half, its two seams, its wheels | [py/README.md](../py/README.md) |
| our SVG renderer's internals — not a seam to implement | [internal-mixer.md](internal-mixer.md), [internal-rig.md](internal-rig.md) |
| what earlier versions cut from the surface, and how to get it back | [removed.md](removed.md) |
| whether it works in a real call | [server/README.md](../server/README.md) |
