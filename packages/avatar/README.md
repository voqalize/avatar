# @voqalize/avatar

A 2-D talking head for AI voice calls, driven by your pipecat client. The
avatars are lip-synced to the audio and they are state aware: they know when
they have been interrupted, when the user is talking versus idle, when a tool
call has started and stopped.

No video track, no per-minute avatar vendor, no second media path. SVG faces
and 2.5-D characters ship with it, one per entry point, so you pay for the one
you import, and you can author your own.

This is the browser half. The pipeline half is
[`voqalize-avatar`](https://pypi.org/project/voqalize-avatar/) on PyPI; they are
two ends of one wire format and release independently, kept compatible by the
wire contract rather than a shared version number
([RELEASING.md § Compatibility](https://github.com/voqalize/avatar/blob/main/RELEASING.md#compatibility)).

**Licence: MIT for the code and the SVG avatars, CC-BY 4.0 for the
2.5-D character binaries** (`assets/*.glb` — see `assets/README.md` for the
credit line). Which applies is decided by the kind of avatar, so adding a
character never moves the line. The manifest declares the pair as
`MIT AND CC-BY-4.0`.

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
involvement at all; `THINKING`, `WORKING` and `CANT_HEAR` come from
`AvatarProcessor` watching turn boundaries, LLM response boundaries and
function-call frames; lipsync comes from the same karaoke frames pipecat already
pushes for word-level captions; blink, breath, gaze aversion and idle motion are
always the renderer's.

What is left over is small, specific, and each item is a case the library
refuses to guess at — a deliberate nod or greeting, a tool whose calls never
enter your pipeline, a pose richer than the core states, a backend that is not
ours. [The wire
contract](https://github.com/voqalize/avatar/blob/main/docs/contract-wire.md) is
the canonical reference for all of it.

## The wire protocol

`state`, `action` and `cues`, one envelope
([contract-wire.md](https://github.com/voqalize/avatar/blob/main/docs/contract-wire.md)):

```json
{ "type": "avatar", "cmd": "state",  "state": "WORKING" }
{ "type": "avatar", "cmd": "action", "id": "ACKNOWLEDGE" }
{ "type": "avatar", "cmd": "cues",   "ctx": "tts-context", "from_ms": 0, "cues": [] }
```

**States are durable and they are prioritised.** A state holds until the facts
change; it does not complete on a timer. **The state pipecat reports always
wins** — bot-output lifecycle and user speech are observed Pipecat facts, and a
state the server sends is a *candidate* underneath them. **Actions are
point-in-time animations** that land on top of whatever state is effective at
the time; they are finite, they complete on their own, and they never establish
state.

Emission is overwrite, never merge: a `cues` message says "discard everything
queued at or after `from_ms`, then append these". The server decides; the client
has no say and no way to refuse.

**Not using our backend?** Any server can produce cues; the ways, best first:
If your TTS emits native viseme events, map the integer ids through
`AZURE_VISEME_TO_LETTER` and ship `{t, v}` as they stream. Otherwise force-align
the text against the audio and map ARPAbet through `ARPABET_TO_VISEME`. With no
server work at all, `textToCues(text)` is a crude grapheme guesser, fit for
previews only. Each is exported from `@voqalize/avatar/internal`.

## The faces

All hand-authored line art: **`peep`** (the default),
**`wren`**, **`myna`**. Each is its own entry point, and you pass the value
rather than a name:

```js
import { myna } from '@voqalize/avatar/faces/myna';

createAvatar({ mount, client, face: myna });
```

A name would need a table, and a table is a dynamic index no bundler can shake —
every drawing in every consumer's bundle to render one.

## The 2.5-D characters

The characters ship as compiled binaries, each its own `createAvatar` module:

```js
import { createAvatar } from '@voqalize/avatar/avatars/tara';
// or: @voqalize/avatar/avatars/tushar
//     @voqalize/avatar/avatars/tanya
//     @voqalize/avatar/avatars/tess
//     @voqalize/avatar/avatars/tanvi

const avatar = createAvatar({ mount, client: pipecatClient });
```

A photograph of a face projected onto shallow geometry, with the parts that have
to move — eyes, teeth, the lip line — built as geometry rather than painted.
Three.js is an *optional* peer (`three`, `>=0.180 <0.187`) behind those
entry points only, so an SVG consumer never downloads it, and the `.glb`
is fetched when the avatar mounts.

Nothing above the renderer changes: the same wire, the same states, the same
cue-synced mouth, and a server that has never heard of these characters drives one
correctly. How far a character's head may turn is not an option either: it is a
limit read off that face by eye, carried per character in
`client/three/motion-limits.json`, which `HEAD_DEG` in
`client/three/character-rig.ts` turns into a pose channel's degrees.

**The binaries are artwork under CC-BY 4.0**, separately from the MIT code
around them; the credit line is in `assets/README.md`. Mounting, sizing, the asset
budget and what the characters can be asked to do:
[characters.md](https://github.com/voqalize/avatar/blob/main/docs/characters.md).

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

An implementation may also export `supports` — one object naming the action ids
it answers to. Nothing in the library reads it; it is there because the wire's
action id is open and an unknown one is ignored in silence, so a page that
drives an avatar otherwise cannot tell a face that has no such motion from one
that did nothing ([design-avatar-interface.md](https://github.com/voqalize/avatar/blob/main/docs/design-avatar-interface.md)).
Omitting it is conforming.

**There is deliberately no renderer interface.** The pose channels our SVG mixer
uses to talk to our faces are internal, and a second public contract stays
premature until a second renderer says what it needs.
