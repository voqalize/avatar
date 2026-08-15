# Avatar — a talking head for pipecat voice agents

A pipecat-focussed avatar library. The avatars are lip-synced to the audio and
they are state aware: they understand when they have been interrupted, when the
user is talking versus idle, when a tool call has started and stopped.
`AvatarProcessor` sits in the pipeline between TTS and the output transport.
The avatar itself is a JavaScript library, driven by the standard RTVI events
your client already receives plus one custom RTVI message carrying lipsync
metadata and semantic cues.

No video track, no per-minute avatar vendor, no second media path. Three SVG
faces ship with it — one drawing per entry point, so you pay for the one you
import — and you can author your own.

`createAvatar({ mount, client }) -> { destroy() }` is the entire public
interface: the avatar is an embodiment of your `PipecatClient` and reacts to it.
To ship a different one — a Rive rig, a WebGL head, anything — publish a module
that exports `createAvatar` and import yours instead of ours. There is no
registry and no plug-in system, and that is the design:
[design-avatar-interface.md](docs/design-avatar-interface.md).

```sh
npm install @voqalize/avatar      # the browser half
pip install voqalize-avatar       # the pipecat half
```

```js
import { createAvatar } from '@voqalize/avatar';

const avatar = createAvatar({ mount: el, client: pipecatClient });
```

```jsx
import { Avatar } from '@voqalize/avatar/react';
import { wren } from '@voqalize/avatar/faces/wren';   // `peep` is the default

<Avatar client={pipecatClient} options={{ face: wren }} className="call-tile" />
```

```python
from voqalize_avatar import AvatarProcessor

pipeline = Pipeline([..., tts, AvatarProcessor(), transport.output()])
```

That is the integration, both halves of it. Neither takes an argument: the
processor infers what the agent is doing from frames already flowing past it,
`StartFrame` supplies the sample rate, and the aligner rides inside the wheel.

## The map

Two of these are contracts — a format someone outside this repo implements or
depends on. The rest are our own internals, and are named so.

| layer | owns | code | reference |
|---|---|---|---|
| **wire** | `claim` / `action` / `cues`, nothing else | `client/src/AvatarClient.ts` | **[contract-wire.md](docs/contract-wire.md)** |
| **avatar** | `createAvatar({mount, client})`, the only public seam | `client/src/createAvatar.ts` | **[design-avatar-interface.md](docs/design-avatar-interface.md)** |
| lifecycle | effective-state precedence, cue-clock anchor | `client/src/AvatarClient.ts` | [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md) |
| behavior | states, actions | `src/behavior.js` | [contract-behavior.md](docs/contract-behavior.md) |
| backend | state inference from stock pipecat frames, the viseme legs | [`py/`](py/README.md) | [`py/README.md`](py/README.md) |
| aligner | A–H+X letters from text *and* from audio | [`native/avatarsync/`](native/avatarsync/README.md) | its own README |
| mixer | layer order, per-channel smoothing, gaze, idle, clips | `src/avatar.js` | [internal-mixer.md](docs/internal-mixer.md) |
| rig | `apply({pose, hand})` / `destroy()`, our SVG renderer's internals | `src/rig.js` | [internal-rig.md](docs/internal-rig.md) |
| SVG faces | the drawings | `src/face-*.js` | [authoring-a-face.md](docs/authoring-a-face.md) |

Repo layout: [design-library-split.md § Layout](docs/design-library-split.md).
Why a library rather than a product, and what each published artifact owns:
the same document. What 0.2 and 0.3 cut from the public surface, and how to get
any of it back: [removed.md](docs/removed.md).

## TTS to visemes

A native library turns speech into [Rhubarb](https://github.com/DanielSWolf/rhubarb-lip-sync)
visemes — the A–H+X alphabet, nine shapes, a condensation of the Preston Blair
mouth set. `avatarsync` is our C++ fork of it, it ships inside the Python wheel
with its acoustic model, loaded into the process through `ctypes`, and
`AvatarProcessor` is the only thing that knows it exists. Nothing to install, no
path, no environment variable, no subprocess.

Every sentence gets answered twice, because waiting for the accurate answer
would delay the audio:

- **fast leg** — predicted from the text the moment it is handed to TTS, before
  any audio exists. ~0.15 ms, on the event loop, and it is what keeps the mouth
  moving from the first frame of playout.
- **accurate leg** — real phone recognition over the rendered PCM, decoded
  *while it streams* on a worker thread, and overwriting the prediction as it
  advances.

Three constants carry the design. `FAST_LEAD_MS = 60` emits predicted cues
early, because the eye is forgiving of a mouth that moves ahead of the sound and
not of one that lags. `HOLD_BACK_MS = 100` is how far behind the fed edge the
accurate track stops — a segment near the edge is still liable to change, and a
shape rewritten under the playhead is a twitch rather than a correction. And
`LATCH_RTF = 0.8` gives up: if decode stops keeping up with playout, the turn
falls back to the fast leg permanently rather than shipping corrections that
arrive after the mouth has already moved on. The rest of the reasoning is in
[`py/src/voqalize_avatar/visemes.py`](py/src/voqalize_avatar/visemes.py), next to
the numbers it explains.

Emission is **overwrite, never merge**: a `cues` message says "discard everything
queued at or after `from_ms`, then append these". The server decides; the client
has no say and no way to refuse.

**Not using our backend?** Any server can produce cues, three ways, best first.
If your TTS emits native viseme events (Azure and friends), map the integer ids
through `AZURE_VISEME_TO_LETTER` and ship `{t, v}` as they stream — nearly free,
and the letters are already ours. Otherwise force-align: phonemize the text,
align it against the audio with MFA, gentle or `rhubarb-lip-sync` itself, and
map ARPAbet through `ARPABET_TO_VISEME`. With no server work at all,
`textToCues(text)` is a crude grapheme guesser, fit for previews only. All three
are exported from `@voqalize/avatar/internal`; the cue format and the rules a
track must satisfy are
[internal-mixer.md § Speech](docs/internal-mixer.md).

## The wire protocol

An RTVI wire protocol sends audio-synced cues to the browser, where the avatar
frontend picks them up and animates. Three commands, one envelope —
[contract-wire.md](docs/contract-wire.md):

```json
{ "type": "avatar", "cmd": "claim",  "state": "WORKING" }
{ "type": "avatar", "cmd": "action", "id": "ACK_NOD" }
{ "type": "avatar", "cmd": "cues",   "ctx": "tts-context", "from_ms": 0, "cues": [] }
```

**States are durable and they are prioritised.** Listening, speaking, thinking,
working, idle — a state holds until the facts change; it does not complete on a
timer. If the bot is talking, that is the highest-priority state and the mouth
articulates, full stop.

**Always prioritise the state pipecat reports.** Bot playout and user speech are
observed facts and they win. A server `claim` is a *candidate* underneath them —
it is how the application says "I am working on a tool call", not a command to
look a particular way. Everything else is cherry on top.

**Actions are point-in-time animation sequences** to drive home a point — a nod,
a wave, a receipt, a gesture. They are finite, they complete on their own, and
they land on top of whatever state is effective at the time. They never
establish state and never need an end message.

Precedence table: [contract-behavior.md § Effective-state precedence](docs/contract-behavior.md).
What the client reads straight off pipecat, and what it deliberately refuses to
infer: [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md).

## The frontend contract

There is one, and it is small: `createAvatar({ mount, client }) -> { destroy() }`
([design-avatar-interface.md](docs/design-avatar-interface.md)). An avatar is an
embodiment of your `PipecatClient` and reacts to it. No methods to drive it, no
callbacks to observe it, no state to read back.

What an avatar author actually needs to understand is therefore the *wire* —
[contract-wire.md](docs/contract-wire.md) and
[contract-behavior.md](docs/contract-behavior.md) — because states, actions and
cues are all the avatar is ever told. `VisemeTrack` in
`@voqalize/avatar/internal` turns a cue array plus a clock into the mouth shape
for the current frame; every renderer needs that and none should write it twice.

**There is deliberately no renderer interface.** The 30 pose channels in
[internal-rig.md](docs/internal-rig.md) are how *our* SVG mixer talks to *our*
faces. That page reads like the renderer seam, and a Rive experiment implemented
it — reconstructing a viseme letter and a `CANT_HEAR` intent out of pose floats
the wire had already stated plainly ([removed.md](docs/removed.md)).
Designing a second public contract stays premature until a second renderer says
what it needs.

## Design

Four decisions the rest of the system rests on. Each one is short because the
code is the reference.

**The face is a vector, not a set of drawings.** Everything the avatar can do is
a point in a ~30-dimensional parameter space ([`src/params.js`](src/params.js));
visemes, emotions, gaze poses and gesture keyframes are all named vectors in it.
Blending a smile into a mid-sentence "oh" is arithmetic rather than SVG path
surgery, and a stream of parameter updates is the *native* input format instead
of something to adapt to. Channel by channel, with rest values, ranges and
smoothing constants:
[internal-rig.md § The pose channels](docs/internal-rig.md).

**Layers mix in a fixed order** — `base pose (state + emotion) → gaze → visemes
→ clip deltas → idle`. Later layers overwrite earlier ones on the channels they
touch; clips and idle are *additive*, so a nod during speech moves the head
while the mouth stays on the server's viseme track with no special-casing. One
hard rule: **while the viseme track is playing it owns the mouth outright**
([internal-mixer.md § The mouth priority rule](docs/internal-mixer.md)).
An interjection firing mid-sentence contributes head and brows; its mouth track
is silently dropped, or the avatar appears to say two things at once.

**Smoothing is the animation.** There is no tweening engine — every channel
chases its target with a frame-rate-independent exponential approach at a
per-channel time constant (mouth 42 ms, lids 18 ms, head 160 ms, lean 240 ms;
the table is in `src/params.js`). That is where the face gets its weight, and it
buys viseme co-articulation for free: shapes are never blended explicitly, the
mouth just retargets and chases.

**Idle motion stays low-amplitude and low-frequency.** The call runs with screen
share and the user's camera on; a jittery avatar in the corner costs the video
encoder real bitrate for no communicative gain, and deliberate stillness is
itself a cue. Where the constants come from:
[research-biomechanics.md](docs/research-biomechanics.md) (how it moves) and
[research-perception.md](docs/research-perception.md) (how it is read).

## The faces

Three ship today, all hand-authored line art in `src/face-*.js`: **`peep`** (the
default and the one under active work), **`wren`**, **`myna`**. Each is its own
entry point, and you pass the value rather than a name:

```js
import { myna } from '@voqalize/avatar/faces/myna';

createAvatar({ mount, client, face: myna });
```

A name would need a table, and a table is a dynamic index no bundler can shake
— three drawings in every consumer's bundle to render one. `src/faces.js` still
has that table, for tooling that genuinely wants all of them.

A whole different rendering technology is not a face; it is a different
`createAvatar`, published as its own module — that is the design, and why there
is no registry ([design-avatar-interface.md](docs/design-avatar-interface.md)).

Authoring a face is a staged process that starts from a reference image rather
than a text brief:
[authoring-a-face.md § Adding a new avatar](docs/authoring-a-face.md).

## Avatar Studio

A browser-based IDE for the avatars. It lets you see them in their various
states, test an avatar you are building, and connect to a live pipecat call to
see how it all works together.

```sh
pnpm install          # one workspace: the package, the IDE and the rig tooling
pnpm run studio:dev
open http://127.0.0.1:4173/#/rig
```

Four workspaces — `#/rig` (raw parameters, visemes, gestures), `#/behavior`
(states and actions), `#/runtime` (replay a deterministic pipecat trace from
time zero), `#/connection` (attach a real `PipecatClient`). Which route
validates which layer, and why Studio will not turn a URL into a pipecat client
for you: [studio/README.md](studio/README.md).

Studio always drives the production behavior and wire adapters, never a
demo-only state machine. It is absorbing the static rig pages under `demo/rig/`,
which remain as reference tools until the matching route reaches parity. Those
need a server, and it must be `python3 serve.py 8777` rather than
`python3 -m http.server` — the stdlib server sends `Last-Modified` and no
`Cache-Control`, so browsers stop revalidating modules you have edited.

## Verifying

```sh
node tools/sweep.mjs      # rig conformance gate — run before committing src/
pnpm test                 # client: dispatcher + jsdom package boundary
cd py && uv run pytest    # backend, against the real avatarsync library
```

Headless render, screenshot and pixel-diff tooling — including a real
"prove this refactor changed nothing on screen" workflow —
is in [tools/README.md](tools/README.md).

`sweep()` passing is not evidence a change looks good: it catches dead avatars,
NaN leaks and detached SVGs, and nothing else. Every defect this project has
found was found by looking at a rendered page.

Releasing both packages from one tag: [RELEASING.md](RELEASING.md).

## License

**AGPL-3.0-only.** Open source, and deliberately the restrictive end of it: you
may use, modify and self-host this freely, but a modified version offered to
users over a network has to offer them its source too. That is a starting
position taken while the project is young, not a final one — Voqalize holds the
copyright on all of it, so relicensing to something permissive later is a
decision we can simply make. Embedding the widget in a closed-source product is
not what this licence permits; if that is what you need, open an issue.

The `avatarsync` aligner in `native/avatarsync/` is a fork of
[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) (MIT). Its
prebuilt binaries statically link pocketsphinx, sphinxbase, flite, WebRTC,
cppformat, GSL, Boost and the CMU acoustic model; upstream's own notice file for
all of them is committed beside them as `native/avatarsync/UPSTREAM-LICENSE.md`,
unchanged, and travels with that directory.

| third-party material | where | terms |
|---|---|---|
| [Open Peeps](https://www.openpeeps.com/) | the drawing *idiom* `peep` is authored in — no artwork is copied | CC0 |
| Rhubarb Lip Sync 1.14.0 | `native/avatarsync/` (fetched at build time, not vendored) | MIT; see `UPSTREAM-LICENSE.md` |
| [piper](https://github.com/OHF-Voice/piper1-gpl) voices `en_US-ljspeech-high`, `en_US-libritts_r-medium` | spoke every wav in `demo/*-audio/` and `py/tests/fixtures/` | LJSpeech public domain; LibriTTS-R CC BY 4.0 |
| [`@ricky0123/vad-web`](https://github.com/ricky0123/vad) + onnxruntime-web | loaded from jsDelivr by `demo/vad.js`, demo only — nothing in `src/` fetches it | MIT |

The three avatars are original drawings. All demo audio is synthesised from
text written for this repo.
