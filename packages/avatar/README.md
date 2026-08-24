# @voqalize/avatar

A 2-D talking head for AI voice calls, driven by your pipecat client. The
avatars are lip-synced to the audio and they are state aware: they know when
they have been interrupted, when the user is talking versus idle, when a tool
call has started and stopped.

No video track, no per-minute avatar vendor, no second media path. Three SVG
faces and two professional Canvas2D interviewer avatars ship with it — one
identity per entry point, so you pay for the one you import — and you can
author your own.

This is the browser half. The pipeline half is
[`voqalize-avatar`](https://pypi.org/project/voqalize-avatar/) on PyPI; they are
two ends of one wire format and publish in lockstep from one tag, because a
version pair that can drift is a protocol mismatch waiting to be debugged in
production.

**Licence: MIT.** Use it anywhere, including in closed-source products.

## Install

```sh
npm install @voqalize/avatar      # this package, the browser half
pip install voqalize-avatar       # the pipecat half
```

Node 20+. The package is ESM with **no runtime dependencies** and ships its own
types. `@pipecat-ai/client-js` (`>=1.4 <2`) and React (`>=18`) are declared as
*optional* peers: the pipecat import is types-only, so nothing fails to load
without it, and React is only for `@voqalize/avatar/react`.

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

That is the integration, both halves of it. Neither takes an argument.
`createAvatar` returns `{ destroy() }` and nothing else — the avatar is an
embodiment of your `PipecatClient` and reacts to it, so there is no avatar to
drive and no state to read back.

## What you get for free

Most of the avatar works on any pipecat application without customization — not
because integrations were enumerated, but because the behaviour is derived from
frames and events a pipecat pipeline already emits. `SPEAKING`, `LISTENING`,
`MUTED`, `OFFLINE` and `DEGRADED` come from your `PipecatClient` with no backend
involvement at all; `THINKING`, `WORKING` and `STRAINING` come from
`AvatarProcessor` watching turn boundaries, LLM response boundaries and
function-call frames; lipsync comes from the same karaoke frames pipecat already
pushes for word-level captions; blink, breath, gaze aversion and idle motion are
always the renderer's.

What is left over is small, specific, and each item is a case the library
refuses to guess at — a deliberate nod or greeting, a tool whose calls never
enter your pipeline, a pose richer than the nine states, a backend that is not
ours. [The architecture
page](https://github.com/voqalize/avatar/blob/main/docs/architecture.md) is the
canonical reference for all of it.

## The wire protocol

Three commands, one envelope
([contract-wire.md](https://github.com/voqalize/avatar/blob/main/docs/contract-wire.md)):

```json
{ "type": "avatar", "cmd": "claim",  "state": "WORKING" }
{ "type": "avatar", "cmd": "action", "id": "ACK_NOD" }
{ "type": "avatar", "cmd": "cues",   "ctx": "tts-context", "from_ms": 0, "cues": [] }
```

**States are durable and they are prioritised.** A state holds until the facts
change; it does not complete on a timer. **The state pipecat reports always
wins** — bot playout and user speech are observed facts, and a server `claim` is
a *candidate* underneath them. **Actions are point-in-time animation
sequences** that land on top of whatever state is effective at the time; they
are finite, they complete on their own, and they never establish state.

Emission is overwrite, never merge: a `cues` message says "discard everything
queued at or after `from_ms`, then append these". The server decides; the client
has no say and no way to refuse.

**Not using our backend?** Any server can produce cues, three ways, best first.
If your TTS emits native viseme events, map the integer ids through
`AZURE_VISEME_TO_LETTER` and ship `{t, v}` as they stream. Otherwise force-align
the text against the audio and map ARPAbet through `ARPABET_TO_VISEME`. With no
server work at all, `textToCues(text)` is a crude grapheme guesser, fit for
previews only. All three are exported from `@voqalize/avatar/internal`.

## The faces

Three ship today, all hand-authored line art: **`peep`** (the default),
**`wren`**, **`myna`**. Each is its own entry point, and you pass the value
rather than a name:

```js
import { myna } from '@voqalize/avatar/faces/myna';

createAvatar({ mount, client, face: myna });
```

A name would need a table, and a table is a dynamic index no bundler can shake —
three drawings in every consumer's bundle to render one.

## Professional interviewer avatars

Two complete, code-authored avatars ship as their own `createAvatar` modules:

```js
import { createAvatar } from '@voqalize/avatar/avatars/interviewer-male';
// or: @voqalize/avatar/avatars/interviewer-female

const avatar = createAvatar({ mount, client: pipecatClient });
```

Both depict Indian professionals in their late twenties, without caricature or
regional costume cues. They are calibrated at call-tile size and preserve all
six expression targets, continuous visemes, gaze, blink, head motion, and the
frame-edge gesture hand. The male and female modules are complete identities,
not face values: import one instead of the default module and do not pass a
`face` option.

They use the same public contract and the same Pipecat lifecycle/viseme driver
as the SVG avatars. Their private renderer is Canvas2D; its rig data and bitmap
wardrobe assets are implementation details and no Canvas or pose API is added
to the package surface.

## Shipping your own avatar

A whole different rendering technology is not a face; it is a different
`createAvatar`, published as its own module — which is why there is no registry.
The interface is small enough to state in one line:

```ts
createAvatar({ mount, client, ...yourOptions }) -> { destroy() }
```

What such an implementation needs to understand is the *wire*, because states,
actions and cues are all an avatar is ever told. `VisemeTrack` in
`@voqalize/avatar/internal` turns a cue array plus a clock into the mouth shape
for the current frame; every renderer needs that and none should write it twice.

**There is deliberately no renderer interface.** The pose channels our SVG mixer
uses to talk to our faces are internal, and a second public contract stays
premature until a second renderer says what it needs.

## What is in this tarball

`dist/` is the compiled client — `AvatarClient`, the avatar entry points and the
React binding. `src/` is the widget itself: the mixer, the SVG rig and drawings,
plus the private Canvas2D interviewer rigs and their assets, as dependency-free
ES modules with no build step, imported by `dist/` through ordinary relative
paths. `client/` is the TypeScript those `dist/` files were compiled from, so
the source maps resolve.

The contract documents do not ship here. They live in the repository, which is
where they are kept current:
[github.com/voqalize/avatar](https://github.com/voqalize/avatar).

## License

**MIT**, and Voqalize holds the copyright on all of it. The drawing idiom `peep`
is authored in is [Open Peeps](https://www.openpeeps.com/) (CC0) — no artwork is
copied. The `avatarsync` aligner that produces the mouth shapes is a fork of
[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) (MIT) and
ships in the Python package, not this one.
