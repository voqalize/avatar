# The rig's pose model — internal

> **This is not the seam to implement.** The public interface is
> `createAvatar({ mount, client })` —
> [design-avatar-interface.md](design-avatar-interface.md). What follows is the
> bundled SVG implementation's internal parameter model: the shape the mixer
> hands its renderer, and the reference an author of *our* faces works against.
>
> This page used to be called `contract-rig.md`, and that name is what sent a
> non-SVG experiment (a Rive rig) to the wrong layer: it reconstructed a Rhubarb letter and a `CANT_HEAR` intent out of
> pose floats that the wire had already stated plainly. A renderer that is not
> ours should take `state` / `action` / `cues` and never see this page.

The interface between the mixer and a rig it drives. It is deliberately
independent of SVG, WebGL, video, and any future rendering technology. The rig
renders; it does not decide what the avatar is doing. The types are in
[`packages/avatar/src/rig.d.ts`](../packages/avatar/src/rig.d.ts).

`mount` is an ordinary DOM element. An SVG rig may append an `<svg>`, a WebGL
rig a `<canvas>`, and a video rig its own compositing surface. No geometry,
viewbox, landmark, or crop metadata crosses this boundary.

## Rig obligations

- `apply()` consumes a complete frame and is idempotent.
- It does not smooth, schedule, infer states, generate idle movement, or react
  to Pipecat/server traffic. Those decisions are already represented in the
  supplied frame.
- It renders canonical pose channels with their documented semantics.
- It renders Rhubarb `A`–`H` and `X` as distinct mouth shapes when the avatar
  has a mouth. A non-human renderer may choose another visual treatment, but
  preserves articulation distinctions.
- It may ignore `frame.hand`. That is a valid handless avatar, not a different
  behavioral API.
- It owns private renderer data: SVG viewboxes, mouth rectangles, layer names,
  shaders, video tracks, and asset handles never become contract fields.

## The pose channels

30 float channels. Each one's rest, range, τ, group and meaning are declared in
`packages/avatar/src/params.js`, which is the only copy of them.

Rest is the neutral face, range is the post-mix clamp, and τ is the smoothing
time constant the *mixer* applies — so a rig never eases anything itself. Sign
conventions are from the **viewer's** perspective.

Clips declare group ownership by the names in `GROUPS`.

**Honour the channel's semantic, not its plumbing.** The value is what an author
of `visemes.js`/`emotions.js` — who never sees your renderer — thinks they are
asking for. The standing example: `mouthOpen` denotes the *visible aperture*.
peep initially mapped it to the gap between lip centrelines; the drawn lip band
was ~11 units thick, so the mouth stayed visibly shut until 0.25, and visemes
live below that. The fix was to solve back from aperture to control
points, not to re-tune the visemes.

A rig should consume all 30. One sanctioned exception exists: peep ignores `jaw`
(its construction has no drawn jaw line to drop — a documented character
decision, not an oversight).

There are deliberately **no arm or hand channels**; the hand is a semantic
frame, below. See the note in `params.js` before considering any.

## Hand control is first-class

The hand is part of `AvatarFrame`, not a generic SVG overlay or face-specific
exception. A behavior action supplies semantic gesture plus progress; each rig
chooses how to render it. A handless rig safely renders the matching face/body
action without a hand.
