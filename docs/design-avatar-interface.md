# The avatar interface

```ts
createAvatar({ mount, client, ...implementationOptions }) -> { destroy() }
```

That is the whole public contract. `client` is a required `PipecatClient`.
**The avatar is an embodiment of `PipecatClient` and reacts to it.** There is no
avatar state beyond what `PipecatClient` exposes, and the caller does not get to
read the avatar's internal state — we do not commit to any such behaviour.

The options, the return value and `supports` — the one optional export beside
`createAvatar` — are documented where they are declared:
[`packages/avatar/client/createAvatar.ts`](../packages/avatar/client/createAvatar.ts).
The entry points and what each one costs a consumer are in
`packages/avatar/package.json`.

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

A renderer receiving `{ state, action, cues }` needs none of that. So the seam
moves up to the client, and there is deliberately no second public contract:
designing a render interface is premature until a second renderer has told us
what it needs.

## What is deliberately not in the interface

**Gaze**, and not by omission. The question is what gaze *communicates*. The
action should be *"highlight that element"* and gaze follows it — not a
lower-level gaze point. Deferred until a need names itself.

`<Avatar>` renders a static `role="img"`. The implementation owns the DOM inside
the mount and is the only thing that knows what it is portraying. React is the
forgiving layer: `client` may be `null` and nothing mounts until it isn't. The
factory stays strict.
