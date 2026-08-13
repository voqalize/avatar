# Avatar — a talking head for pipecat voice agents

A pipecat-focussed avatar library. The avatars are lip-synced to the audio and
they are state aware: they understand when they have been interrupted, when the
user is talking versus idle, when a tool call has started and stopped.
`AvatarProcessor` sits in the pipeline between TTS and the output transport.
The avatar itself is a JavaScript library, driven by the standard RTVI events
your client already receives plus one custom RTVI message carrying lipsync
metadata and semantic cues.

No video track, no per-minute avatar vendor, no second media path. Three SVG
avatars ship with it, you can author your own, and there is experimental
support for [Rive](docs/rive-proof.md).

```sh
npm install @voqalize/avatar      # the browser half
pip install voqalize-avatar       # the pipecat half
```

```jsx
import { Avatar } from '@voqalize/avatar';

<Avatar client={pipecatClient} avatar="peep" className="call-tile" />
```

```python
from voqalize_avatar import AvatarProcessor

pipeline = Pipeline([..., tts, AvatarProcessor(), transport.output()])
```

That is the integration, both halves of it. Neither takes an argument: the
processor infers what the agent is doing from frames already flowing past it,
`StartFrame` supplies the sample rate, and the aligner rides inside the wheel.

## The map

| layer | owns | code | contract |
|---|---|---|---|
| backend | state inference from stock pipecat frames, the viseme legs | [`py/`](py/README.md) | [contract-protocol.md](docs/contract-protocol.md) |
| aligner | A–H+X letters from text *and* from audio | [`native/avatarsync/`](native/avatarsync/README.md) | its own README |
| wire | `claim` / `action` / `cues`, nothing else | `client/src/AvatarClient.ts` | [contract-wire.md](docs/contract-wire.md) |
| lifecycle | effective-state precedence, cue-clock anchor | `client/src/AvatarClient.ts` | [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md) |
| behavior | states, actions, state programs | `src/behavior.js` | [contract-behavior.md](docs/contract-behavior.md) |
| rig | `apply({pose, hand})` / `destroy()`, renderer-agnostic | `src/rig.js` | [contract-rig.md](docs/contract-rig.md) |
| mixer | layer order, per-channel smoothing, gaze, idle, clips | `src/avatar.js` | [contract-protocol.md](docs/contract-protocol.md) |

Repo layout: [design-library-split.md § Layout](docs/design-library-split.md).
Why a library rather than a product, and what each published artifact owns:
the same document. What 0.2 cut from the public surface and how to get any of
it back: [removed.md](docs/removed.md).

## TTS to visemes

A native library turns speech into [Rhubarb](https://github.com/DanielSWolf/rhubarb-lip-sync)
visemes — the A–H+X alphabet, nine shapes, a condensation of the Preston Blair
mouth set. `avatarsync` is our C++ fork of it, it ships inside the Python wheel
with its acoustic model, and `AvatarProcessor` is the only thing that knows the
binary exists. Nothing to install, no path, no environment variable.

Every sentence gets answered twice, because waiting for the accurate answer
would delay the audio:

- **fast leg** — predicted from the text the moment it is handed to TTS, before
  any audio exists. ~0.4 ms, and it is what keeps the mouth moving from the
  first frame of playout.
- **accurate leg** — real phone recognition over the rendered PCM, ~15–31 ms,
  once that sentence's audio has fully arrived.

Shortly after the audio starts, accurate cues land and the client splices them
in. A third **early leg** covers the opening of the turn, where the fast leg's
inaccuracy is most visible and there is not yet a whole sentence of audio to
recognise.

The one constant worth knowing here is `EARLY_SPLICE_MS = 500`: a correction
must land *behind* the playhead, because a mouth shape rewritten under the
playhead is a twitch rather than a correction. The rest of the reasoning — why
predicted tracks lead, how a resolved sentence re-places the ones after it — is
in [`py/src/voqalize_avatar/visemes.py`](py/src/voqalize_avatar/visemes.py),
next to the numbers it explains.

Not using our backend? [contract-protocol.md § Producing cues server-side](docs/contract-protocol.md)
covers native TTS viseme events and forced alignment.

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

## The two frontend contracts

The frontend has two clear boundaries, deliberately at different altitudes.

**The authoring contract is low level** —
[contract-rig.md](docs/contract-rig.md), [`src/rig.js`](src/rig.js). Mouth
shapes, eyelids, eyebrows, head pose, a hand gesture and its progress. Low-level
control of the avatar behind a well-defined JavaScript contract, so avatar
developers have a strong protocol to work against — and, more importantly, so
different avatars can be trusted to work against the same one.

**The driving contract is higher level** —
[contract-behavior.md](docs/contract-behavior.md),
[`src/behavior.js`](src/behavior.js). States, actions and state programs, so the
same logic applies across every avatar.

The rig renders; it does not decide. No viewBox, crop, layer name, shader or
asset handle crosses that seam.

## Design

Four decisions the rest of the system rests on. Each one is short because the
code is the reference.

**The face is a vector, not a set of drawings.** Everything the avatar can do is
a point in a ~30-dimensional parameter space ([`src/params.js`](src/params.js));
visemes, emotions, gaze poses and gesture keyframes are all named vectors in it.
Blending a smile into a mid-sentence "oh" is arithmetic rather than SVG path
surgery, and a stream of parameter updates is the *native* input format instead
of something to adapt to. Channel by channel, with rest values and ranges:
[contract-avatar.md § The parameter vector](docs/contract-avatar.md).

**Layers mix in a fixed order** — `base pose (state + emotion) → gaze → visemes
→ clip deltas → idle`. Later layers overwrite earlier ones on the channels they
touch; clips and idle are *additive*, so a nod during speech moves the head
while the mouth stays on the server's viseme track with no special-casing. One
hard rule: **while the viseme track is playing it owns the mouth outright**
([contract-protocol.md § The mouth priority rule](docs/contract-protocol.md)).
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

## The avatars

An avatar is a small JavaScript interface: a factory that takes a mount
element, and an `apply()`.

```js
const myRig = (mount, options) => ({
  apply({ pose, hand }) { /* render one frame */ },
  destroy() {},
});

createAvatar({ mount, rig: myRig });
```

Three ship today, all hand-authored line art in `src/face-*.js`: **`peep`** (the
default and the one under active work), **`wren`**, **`myna`**. Our avatars are
SVG art, but the contract is renderer-neutral — `studio/src/rive-bob.ts` drives
a Rive file through the same `apply({pose, hand})` and proves it. That is
integration feasibility, not visual parity ([rive-proof.md](docs/rive-proof.md)).
Bring your own approach if you need to.

The intention is a plug-and-play option for creating new avatars. **The
interface exists; dynamic registration does not yet** — `AVATARS` in
`src/avatar.js` is a static registry, and a rig outside it is handed to
`createAvatar({ rig })` directly.

Authoring one is a staged process that starts from a reference image rather
than a text brief:
[contract-avatar.md § Adding a new avatar](docs/contract-avatar.md).

## Avatar Studio

A browser-based IDE for the avatars. It lets you see them in their various
states, test an avatar you are building, and connect to a live pipecat call to
see how it all works together.

```sh
npm install && npm --prefix studio install
npm run studio:dev
open http://127.0.0.1:4173/#/rig
```

Four workspaces — `#/rig` (raw parameters, visemes, gestures), `#/behavior`
(states and actions), `#/runtime` (replay a deterministic pipecat trace from
time zero), `#/connection` (attach a real `PipecatClient`). Which one validates
which contract: [studio-verification.md](docs/studio-verification.md). Why
Studio will not turn a URL into a pipecat client for you:
[studio/README.md](studio/README.md).

Studio always drives the production behavior and wire adapters, never a
demo-only state machine. It is absorbing the static rig pages under `demo/rig/`,
which remain as reference tools until the matching route reaches parity. Those
need a server, and it must be `python3 serve.py 8777` rather than
`python3 -m http.server` — the stdlib server sends `Last-Modified` and no
`Cache-Control`, so browsers stop revalidating modules you have edited.

## Verifying

```sh
node tools/sweep.mjs      # rig conformance gate — run before committing src/
npm test                  # client: dispatcher + jsdom package boundary
cd py && uv run pytest    # backend, against the real avatarsync binary
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
