# The avatar interface

```ts
createAvatar({ mount, client, ...implementationOptions }) -> { destroy() }
```

That is the whole public contract. `client` is a required `PipecatClient`.
**The avatar is an embodiment of `PipecatClient` and reacts to it.** There is no
avatar state beyond what `PipecatClient` exposes, and the caller does not get to
read the avatar's internal state — we do not commit to any such behaviour.

Code: [`packages/avatar/client/createAvatar.ts`](../packages/avatar/client/createAvatar.ts).

## Adding an avatar

Publish a module that exports `createAvatar`. Import yours instead of ours.

```js
import { createAvatar } from "@acme/our-mascot";
```

No registry, no loader, no plug-in system, no asset resolution. Duck typing on
the top-most layer: an Avatar *is* the API. Everything underneath is
implementation detail and may be shared — `@voqalize/avatar/internal` exists for
exactly that — but externally it is only `createAvatar`.

Ours ships `peep`, `wren`, `myna` as `{ face }` — a value imported from
`@voqalize/avatar/faces/<name>`, never a name looked up in a table, so importing
one costs one drawing. Every other option belongs to whoever wrote the
implementation; nothing reads them but them.

Ours also ships six complete Canvas2D implementations, at
`@voqalize/avatar/avatars/{arjun,meera,vikram,ishita,kabir,naina}`. Each exports
the same `createAvatar` function and fixes one identity behind it. Their shared
renderer, pose evaluator, rig data and wardrobe images are private code reuse,
not another public interface and not a registry. (The original entry points —
`interviewer-male`/`interviewer-female`/`professional-male-a`/`professional-female-a`/`professional-male-b`/`professional-female-b`
— still work as `@deprecated` aliases for the names above; renamed for
memorability without touching the SVG faces.)

## Why there is no renderer interface

The [rig pose model](internal-rig.md) is 30 float pose channels. It reads like the
renderer seam — it is the seam a Rive experiment plugged into — and that was the
mistake: **it implemented the lower-level protocol that was SVG focussed instead
of the wire protocol.** The evidence, all from that one adapter, and the finding
is why this page exists:

- The `.riv` had no head/gaze axes to receive `headYaw`/`headPitch`/`torsoTurn`,
  but did have a `headYes` trigger that wanted `ACK_NOD`.
- It thresholded `mouthOpen`/`mouthPress`/`mouthTuck` back into a Rhubarb
  letter, with an inverse not derived from `VISEME_SHAPES` — reconstructing an
  input the wire had already carried.
- `expressionFor()` reverse-engineered `CANT_HEAR` out of brow and squint
  values. The rig inferring intent is precisely what CLAUDE.md forbids.

A renderer receiving `{ claim, action, cues }` needs none of that. So the seam
moves up to the client, and there is deliberately no second public contract:
designing a render interface is premature until a second renderer has told us
what it needs.

## What is shared, and what is not

| | |
|---|---|
| **the viseme clock** | `VisemeTrack` — cues + clock → which letter is on screen now. Every renderer needs it, none should write it twice. A library class to construct, not a contract to implement. `@voqalize/avatar/internal`. |
| **compound behaviour** | Necessary for SVG, unnecessary for a renderer that authors its own transitions — a Rive state machine, say, is this layer and the rig fused. Stays inside our implementation ([`packages/avatar/src/behavior.js`](../packages/avatar/src/behavior.js), the mixer in [`packages/avatar/src/avatar.js`](../packages/avatar/src/avatar.js)). |
| **gaze** | Not in the interface, and not by omission. The question is what gaze *communicates*. The action should be *"highlight that element"* and gaze follows it — not a lower-level gaze point. Deferred until a need names itself. |

## Layers

Three, and only the first is public.

| | owns | code |
|---|---|---|
| **Avatar** | `createAvatar`, the pipecat binding, effective-state precedence, cue-clock anchor | `packages/avatar/client/{createAvatar,AvatarClient}.ts` · [contract-wire.md](contract-wire.md), [pipecat-lifecycle-protocol.md](pipecat-lifecycle-protocol.md) |
| **Behavior** | states → sustained pose/gaze/idle, actions → finite clips | `packages/avatar/src/behavior.js` · [contract-behavior.md](contract-behavior.md) |
| **Renderer** | the SVG mixer, the pose channels, the faces | `packages/avatar/src/avatar.js`, `packages/avatar/src/rig.js`, `packages/avatar/src/face-*.js` · [internal-rig.md](internal-rig.md) |

An avatar author reads the first two. The third is our implementation's internal
reference, published under `/internal` with no semver promise.

## Entry points

| | |
|---|---|
| `@voqalize/avatar` | `createAvatar`. Framework-free; `@pipecat-ai/client-js` is a type-only import, so even that peer stays genuinely optional at runtime. Carries one drawing: `peep`, the default `face`. |
| `@voqalize/avatar/faces/{peep,wren,myna}` | One drawing each, to pass as `face`. Separate entry points because a name-keyed table is a dynamic index no bundler can shake — the others would ship with it. |
| `@voqalize/avatar/react` | `<Avatar client create options>`. Separate so `createAvatar` costs a non-React caller nothing. |
| `@voqalize/avatar/internal` | The SVG widget, the behavior catalog, `VisemeTrack`. **No semver promise** — moves in any minor. |

React is the forgiving layer: `client` may be `null` and nothing mounts until it
isn't. The factory stays strict.

## Consequences

- No `onPresenceChange`, no `onRemoteAudioLevel`, no `data-avatar-state`. A
  callback is a contract — publishing one obliges every implementation to emit
  the seven states with our precedence rules, which is the second public
  contract this design exists to avoid.
- `<Avatar>` renders a static `role="img"`. The implementation owns the DOM
  inside the mount and is the only thing that knows what it is portraying.
- `WORKING` reaches the renderer as `WORKING`. It used to arrive as `TYPING` —
  a behaviour named after one rendering of it, telling an implementation what to
  *draw* rather than what was happening.
