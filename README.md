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

<p>
  <img src="docs/assets/readme-peep-speaking.png" alt="peep, mid-utterance" width="180">
  <img src="docs/assets/readme-wren-listening.png" alt="wren, listening" width="180">
  <img src="docs/assets/readme-myna-thinking.png" alt="myna, thinking" width="180">
</p>

`peep` speaking, `wren` listening, `myna` thinking — rendered from this repo by
`apps/authoring/tools/shot.mjs`, at roughly the size they ship at. They move, and a
still frame is the one thing this README cannot show you; a call with
[`apps/server/`](apps/server/README.md) takes about a minute and needs no API key. A
hosted demo is planned and does not exist yet.

**Licence: MIT.** Use it anywhere, including in closed-source products. The
third-party attributions that travel with it are under [License](#license).

## Works with

| | |
|---|---|
| pipecat, pipeline side | `pipecat-ai>=1.4,<2`. Base pipecat only — no transport, STT or TTS extras, because this package sits in somebody else's pipeline. The suite runs at the floor as well as at the resolved version ([packages/avatar-py/README.md § Compatibility](packages/avatar-py/README.md)). |
| Python | 3.12+ |
| pipecat, browser side | `@pipecat-ai/client-js` at `>=1.4 <2`, declared an **optional** peer: the package imports its types only, so nothing fails to load without it. React `>=18` is likewise optional, and only for `@voqalize/avatar/react`. |
| Node | 20+. The browser half is ESM with no runtime dependencies and ships its own types. |
| transports | Any. Nothing in either package names a transport: the three commands ride the RTVI data channel your client already has, and no video track is added or asked for. The two surfaces in this repo run on `SmallWebRTCTransport`. |
| lipsync wheels | Linux x86-64 and aarch64 (manylinux — RHEL 8+, Debian 10+, Ubuntu 18.04+) and macOS arm64 (macOS 11+). No Intel macOS, for an upstream reason: pipecat requires `onnxruntime`, which publishes no macOS x86-64 wheel, so nothing depending on pipecat installs there at all. |

The wheel is ~44 MB because it carries the aligner and its acoustic model; the
platform tag is derived from the compiled binary rather than declared, and
`.github/workflows/wheels.yml` is the canonical list
([packages/avatar-py/README.md § Mouth shapes](packages/avatar-py/README.md)).

**Everywhere else installs the sdist, which carries no binary, and that is an
ordinary condition rather than a failure.** `AvatarProcessor` catches, logs
once, and runs the session state-channel only. The degradation is bounded and it
is exactly one thing: the face still listens, thinks, claims the floor and
yields it; its mouth does not move while it speaks. There is no client-side
lipsync to fall back on.

## Install

```sh
npm install @voqalize/avatar      # the browser half
pip install voqalize-avatar       # the pipecat half
```

They are the two ends of one wire format and publish in lockstep from one tag,
because a version pair that can drift is a protocol mismatch waiting to be
debugged in production ([RELEASING.md](RELEASING.md)).

## Getting started

In the browser, wherever your app already renders the bot's tile:

```js
import { createAvatar } from '@voqalize/avatar';

const avatar = createAvatar({ mount: el, client: pipecatClient });
```

```jsx
import { Avatar } from '@voqalize/avatar/react';
import { wren } from '@voqalize/avatar/faces/wren';   // `peep` is the default

<Avatar client={pipecatClient} options={{ face: wren }} className="call-tile" />
```

In the pipeline, between the TTS service and the transport's output — the seat
where it can see the audio that is about to be spoken, at generation speed:

```python
from voqalize_avatar import AvatarProcessor

pipeline = Pipeline([..., tts, AvatarProcessor(), transport.output()])
```

That is the integration, both halves of it. Neither takes an argument: the
processor infers what the agent is doing from frames already flowing past it,
`StartFrame` supplies the sample rate, and the aligner rides inside the wheel.
`createAvatar` returns `{ destroy() }` and nothing else — the avatar is an
embodiment of your `PipecatClient` and reacts to it, so there is no avatar to
drive and no state to read back
([design-avatar-interface.md](docs/design-avatar-interface.md)).

One optional line: forwarding your RTVI processor's `on_client_ready` event to
`avatar.on_client_ready()` re-announces the current state once the browser's
data channel exists. Skipping it costs the widget its opening pose, nothing
more — [`apps/server/bot.py`](apps/server/bot.py) does it in three lines.

### Seeing it move

`apps/server/` is one pipecat process with canned LLM and TTS services behind the
real pipecat interfaces, so the frames the avatar reads are the frames a
production pipeline produces. No API key, no account, no model download
([apps/server/README.md](apps/server/README.md)):

```sh
pnpm install && pnpm -w run build && pnpm -w run server:vendor
cd packages/avatar-py && uv run --group server python ../../apps/server/server.py
# then open the URL it prints — click Start call; the bot speaks first
```

**Avatar Studio** is the IDE for `createAvatar`, pointed at that same server. One
screen, and the connection picks the mode. Disconnected, it drives the published
option surface — face, the three gains, the hand and its side — and writes the
`createAvatar` call you would paste as you change them; at the defaults that is
one line. In a call, that panel gives way to what the *server* can do to the
face: the pre-speech beats, the interjections, and the misbehaviours it sends on
purpose.

```sh
pnpm -w run studio:dev               # with apps/server/ running in another terminal
open https://avatar.local.voqalize.com/
```

Studio imports `@voqalize/avatar` and nothing else from this repo — no `packages/avatar/src/`,
no `/internal` — so a thing it cannot do is a thing a consumer cannot do:
[apps/studio/README.md](apps/studio/README.md).

## What you get for free

Without any customization, most of the avatar works on any pipecat application
— not because integrations were enumerated, but because the behaviour is
derived from frames and events a pipecat pipeline already emits. `SPEAKING`,
`LISTENING`, `MUTED`, `OFFLINE` and `DEGRADED` come from your `PipecatClient`
with no backend involvement at all; `THINKING`, `WORKING` and `STRAINING` come
from `AvatarProcessor` watching turn boundaries, LLM response boundaries and
function-call frames; lipsync comes from the same karaoke frames pipecat already
pushes for word-level captions; blink, breath, gaze aversion and idle motion are
always the renderer's.

What is left over is small, specific, and each item is a case the library
refuses to guess at — a deliberate nod or greeting, a tool whose calls never
enter your pipeline, a pose richer than the nine states, a backend that is not
ours. **[docs/architecture.md](docs/architecture.md) is the canonical page for
all of this**: how the pieces relate, the five principles they rest on, and the
free/costs-a-line table in full. Read it before deciding whether this fits your
pipeline.

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
  moving from the start of Pipecat bot output.
- **accurate leg** — real phone recognition over the rendered PCM, decoded
  *while it streams* on a worker thread, and overwriting the prediction as it
  advances.

Three constants carry the design. `PREDICTED_CUE_LEAD_MS = 60` emits predicted cues
early, because the eye is forgiving of a mouth that moves ahead of the sound and
not of one that lags. `ACCURATE_CUE_HOLD_BACK_MS = 100` is how far behind the fed edge the
accurate track stops — a segment near the edge is still liable to change, and a
shape rewritten under the playhead is a twitch rather than a correction. And
`ACCURATE_CUE_LATCH_RTF = 0.8` gives up: if decode stops keeping up with output, the turn
falls back to the fast leg permanently rather than shipping corrections that
arrive after the mouth has already moved on. The rest of the reasoning is in
[`packages/avatar-py/src/voqalize_avatar/visemes.py`](packages/avatar-py/src/voqalize_avatar/visemes.py), next to
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

**Always prioritise the state pipecat reports.** Bot-output lifecycle and user
speech are observed Pipecat facts and they win. A server `claim` is a
*candidate* underneath them —
it is how the application says "I am working on a tool call", not a command to
look a particular way. Everything else is cherry on top.

**Actions are point-in-time animation sequences** to drive home a point — a nod,
a wave, a receipt, a gesture. They are finite, they complete on their own, and
they land on top of whatever state is effective at the time. They never
establish state and never need an end message.

Precedence table: [contract-behavior.md § Effective-state precedence](docs/contract-behavior.md).
What the client reads straight off pipecat, and what it deliberately refuses to
infer: [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md).

## The faces

Three ship today, all hand-authored line art in `packages/avatar/src/face-*.js`: **`peep`** (the
default and the one under active work), **`wren`**, **`myna`**. Each is its own
entry point, and you pass the value rather than a name:

```js
import { myna } from '@voqalize/avatar/faces/myna';

createAvatar({ mount, client, face: myna });
```

A name would need a table, and a table is a dynamic index no bundler can shake
— three drawings in every consumer's bundle to render one. `packages/avatar/src/faces.js` still
has that table, for tooling that genuinely wants all of them.

Authoring a face of your own is a staged process that starts from a reference
image rather than a text brief:
[authoring-a-face.md § Adding a new avatar](docs/authoring-a-face.md).

## Shipping your own avatar

A whole different rendering technology is not a face; it is a different
`createAvatar`, published as its own module — that is the design, and why there
is no registry ([design-avatar-interface.md](docs/design-avatar-interface.md)).
The interface is small enough to state in one line:

```ts
createAvatar({ mount, client, ...yourOptions }) -> { destroy() }
```

What such an implementation actually needs to understand is the *wire* —
[contract-wire.md](docs/contract-wire.md) and
[contract-behavior.md](docs/contract-behavior.md) — because states, actions and
cues are all an avatar is ever told. `VisemeTrack` in
`@voqalize/avatar/internal` turns a cue array plus a clock into the mouth shape
for the current frame; every renderer needs that and none should write it twice.

**There is deliberately no renderer interface.** The 30 pose channels in
[internal-rig.md](docs/internal-rig.md) are how *our* SVG mixer talks to *our*
faces. That page reads like the renderer seam, and a Rive experiment implemented
it — reconstructing a viseme letter and a `CANT_HEAR` intent out of pose floats
the wire had already stated plainly.
Designing a second public contract stays premature until a second renderer says
what it needs.

---

The rest of this page is about working on the library rather than using it.

## Working on the library

Two of these layers are contracts — a format someone outside this repo
implements or depends on. The rest are our own internals, and are named so.

| layer | owns | code | reference |
|---|---|---|---|
| **wire** | `claim` / `action` / `cues`, nothing else | `packages/avatar/client/AvatarClient.ts` | **[contract-wire.md](docs/contract-wire.md)** |
| **avatar** | `createAvatar({mount, client})`, the only public seam | `packages/avatar/client/createAvatar.ts` | **[design-avatar-interface.md](docs/design-avatar-interface.md)** |
| lifecycle | effective-state precedence, cue-clock anchor | `packages/avatar/client/AvatarClient.ts` | [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md) |
| behavior | states, actions | `packages/avatar/src/behavior.js` | [contract-behavior.md](docs/contract-behavior.md) |
| backend | state inference from stock pipecat frames, the viseme legs | [`packages/avatar-py/`](packages/avatar-py/README.md) | [`packages/avatar-py/README.md`](packages/avatar-py/README.md) |
| aligner | A–H+X letters from text *and* from audio | [`packages/avatar-py/native/avatarsync/`](packages/avatar-py/native/avatarsync/README.md) | its own README |
| mixer | layer order, per-channel smoothing, gaze, idle, clips | `packages/avatar/src/avatar.js` | [internal-mixer.md](docs/internal-mixer.md) |
| rig | `apply({pose, hand})` / `destroy()`, our SVG renderer's internals | `packages/avatar/src/rig.js` | [internal-rig.md](docs/internal-rig.md) |
| SVG faces | the drawings | `packages/avatar/src/face-*.js` | [authoring-a-face.md](docs/authoring-a-face.md) |

The two bold rows are the contracts, and only they carry a semver promise.
Everything below them is named `internal-*` for the same reason it ships under
`@voqalize/avatar/internal`: a future renderer must not plug into the wrong
seam, and one already did.

### Repo map

Two packages ship, both under `packages/`:

| | |
|---|---|
| `packages/avatar/` | `@voqalize/avatar`. `src/` is the widget itself — mixer, rig, the three drawings, as dependency-free ES modules with no build step, so what you screenshot is what ships. `client/` is `AvatarClient` (splice, clock anchor) and the React binding, compiled with plain `tsc` into `dist/`, which imports `../src/` as an ordinary sibling. |
| `packages/avatar-py/` | `voqalize-avatar`, the pipecat backend: state inference from stock frames, and both viseme legs. `native/avatarsync/` inside it is the aligner — our Rhubarb fork, built into the shared library that rides inside the wheel. |

Three more do not ship, and each answers exactly one question.
[`apps/server/`](apps/server/README.md) — *does it work in a real call?* — is one pipecat
process with canned LLM and TTS behind the real interfaces, zero API keys, and
the only place lipsync is ever judged. [`apps/studio/`](apps/studio/README.md) — *is the
published interface enough?* — is the IDE, pointed at that server and importing
`@voqalize/avatar` exactly as a consumer would.
[`apps/authoring/`](apps/authoring/README.md) — *does the drawing read?* — is the
workshop: rig pages, clip fixtures and headless tooling, no build step, served
by `python3 apps/authoring/serve.py 8777`. The hero images above came out of it.

`docs/` is the prose half of the contracts, binding on both packages. The full
tree, path by path: [design-library-split.md § Layout](docs/design-library-split.md),
which is also why this is a library rather than a product and what each
published artifact owns.

### Verifying

```sh
pnpm test                 # client, package boundary, and the rig conformance sweep
cd packages/avatar-py && uv run pytest    # backend, against the real avatarsync library
```

Headless render, screenshot and pixel-diff tooling — including a real
"prove this refactor changed nothing on screen" workflow —
is in [apps/authoring/tools/README.md](apps/authoring/tools/README.md).

The conformance sweep passing is not evidence a change looks good: it catches
dead avatars, NaN leaks and detached SVGs, and nothing else. Every defect this
project has found was found by looking at a rendered page.

Releasing both packages from one tag: [RELEASING.md](RELEASING.md).

## Design

Four decisions the SVG renderer rests on. Each one is short because the code is
the reference; the system-level principles are
[docs/architecture.md](docs/architecture.md) instead.

**The face is a vector, not a set of drawings.** Everything the avatar can do is
a point in a ~30-dimensional parameter space ([`packages/avatar/src/params.js`](packages/avatar/src/params.js));
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
the table is in `packages/avatar/src/params.js`). That is where the face gets its weight, and it
buys viseme co-articulation for free: shapes are never blended explicitly, the
mouth just retargets and chases.

**Idle motion stays low-amplitude and low-frequency.** The call runs with screen
share and the user's camera on; a jittery avatar in the corner costs the video
encoder real bitrate for no communicative gain, and deliberate stillness is
itself a cue. Where the constants come from:
[research-biomechanics.md](docs/research-biomechanics.md) (how it moves) and
[research-perception.md](docs/research-perception.md) (how it is read).

## License

**MIT.** Use, modify, embed and redistribute it, in open- or closed-source
products, with no obligation beyond keeping the copyright notice. Voqalize holds
the copyright on all of it; `/LICENSE` is the whole of our terms.

What follows is not a restriction on this project — it is the attribution that
travels with material we did not write, and the reason `UPSTREAM-LICENSE.md` is
committed rather than fetched.

The `avatarsync` aligner in `packages/avatar-py/native/avatarsync/` is a fork of
[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) (MIT). Its
prebuilt binaries statically link pocketsphinx, sphinxbase, flite, WebRTC,
cppformat, GSL, Boost and the CMU acoustic model; upstream's own notice file for
all of them is committed beside them as `packages/avatar-py/native/avatarsync/UPSTREAM-LICENSE.md`,
unchanged, and travels with that directory.

| third-party material | where | terms |
|---|---|---|
| [Open Peeps](https://www.openpeeps.com/) | the drawing *idiom* `peep` is authored in — no artwork is copied | CC0 |
| Rhubarb Lip Sync 1.14.0 | `packages/avatar-py/native/avatarsync/` (fetched at build time, not vendored) | MIT; see `UPSTREAM-LICENSE.md` |
| [piper](https://github.com/OHF-Voice/piper1-gpl) voices `en_US-ljspeech-high`, `en_US-libritts_r-medium` | spoke every clip in `apps/authoring/*-audio/` (wav) and `packages/avatar-py/tests/fixtures/` (pcm) | LJSpeech public domain; LibriTTS-R CC BY 4.0 — the one row here that asks for attribution |

The three avatars are original drawings. All demo audio is synthesised from
text written for this repo; `apps/server/audio/` is Voqalize's own `omnivoice`
voices, which is why that corpus is not in the table above.
