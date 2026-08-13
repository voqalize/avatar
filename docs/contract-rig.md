# Rig contract

> **This is not the seam to implement.** The public interface is
> `createAvatar({ mount, client })` —
> [design-avatar-interface.md](design-avatar-interface.md). What follows is the
> bundled SVG implementation's internal parameter model: the shape the mixer
> hands its renderer, and the reference an author of *our* faces works against.
>
> It reads like the renderer contract, and that heading is what sent a
> non-SVG experiment (a Rive rig, removed 2026-08-12 — `docs/removed.md`) to the
> wrong layer: it reconstructed a Rhubarb letter and a `CANT_HEAR` intent out of
> pose floats that the wire had already stated plainly. A renderer that is not
> ours should take `claim` / `action` / `cues` and never see this page.

The contract between the mixer and a rig it drives. It is deliberately
independent of SVG, WebGL, video, and any future rendering technology. The rig
renders; it does not decide what the avatar is doing.

```ts
export type RigChannel = string;
export type RigPose = Readonly<Record<RigChannel, number>>;

export interface HandFrame {
  gesture: "greet" | "farewell" | "approve" | "wait";
  progress: number; // normalized action progress, inclusive
  side: "left" | "right"; // viewer-relative
}

export interface AvatarFrame {
  pose: RigPose; // complete, already mixed and smoothed
  hand?: HandFrame;
}

export interface AvatarRig {
  apply(frame: AvatarFrame): void;
  destroy(): void;
}

export type AvatarRigFactory = (mount: HTMLElement, options?: unknown) => AvatarRig;
```

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

30 float channels (`src/params.js`). Rest is the neutral face; range is the
post-mix clamp; τ is the smoothing time constant the *mixer* applies, so a rig
never eases anything itself. Sign conventions are from the **viewer's**
perspective.

| channel | rest | range | τ (s) | means |
|---|---|---|---|---|
| `mouthOpen` | 0.02 | 0..1 | 0.042 | visible vertical aperture |
| `mouthWidth` | 0.42 | 0..1 | 0.042 | narrow..wide (0.42 neutral) |
| `mouthRound` | 0.10 | 0..1 | 0.042 | pucker / protrusion |
| `mouthPress` | 0.15 | 0..1 | 0.042 | lips thinned & pressed |
| `mouthTuck` | 0 | 0..1 | 0.042 | lower lip under upper teeth (F/V) |
| `mouthCornerL/R` | 0.10 | −1.4..1.4 | 0.13 | −frown..+smile |
| `teethUpper` | 0 | 0..1 | 0.042 | upper-teeth reveal |
| `tongue` | 0 | 0..1 | 0.042 | tongue raised into aperture (L) |
| `jaw` | 0 | 0..1 | 0.07 | extra chin drop, lags the lips |
| `lidL/R` | 0.12 | 0..1 | 0.018 | 0 wide open..1 closed; rest grazes the iris |
| `squintL/R` | 0 | 0..1 | 0.12 | lower lid raised (smile/suspicion) |
| `pupilX/Y` | 0 / 0.05 | −1..1 | 0.032 | gaze offset, +right / +down |
| `browRaiseL/R` | 0 | −1..1 | 0.08 | whole-brow lift |
| `browAngleL/R` | 0 | −1.4..1.4 | 0.08 | outer-end up |
| `browInnerL/R` | 0 | −1..1 | 0.08 | inner-end lift (AU1, "concern") |
| `headYaw` | 0 | −1.4..1.4 | 0.16 | + toward viewer's right |
| `headPitch` | 0 | −1.4..1.4 | 0.16 | + chin down |
| `headRoll` | 0 | −1.4..1.4 | 0.16 | + tilt toward viewer's right |
| `breath` | 0 | 0..1 | 0.25 | idle-driven breathing cycle |
| `shoulderL/R` | 0 | −1..1 | 0.19 | −dropped..+raised |
| `torsoLean` | 0 | −1..1 | 0.24 | −back..+forward; reads as scale change |
| `torsoTurn` | 0 | −1..1 | 0.44 | trunk lateral travel, + toward viewer's right |

Groups (`GROUPS`): `mouth`, `smile`, `eyes`, `gaze`, `brows`, `head`, `body`
(breath + torsoLean + torsoTurn), `shoulders` — clips declare group ownership by
them.

`torsoTurn`'s time constant is nearly 3× the head's, and that ratio is
load-bearing rather than taste: the mixer feeds it the *same* target as
`headYaw` (scaled by `TRUNK_FOLLOW = 0.45` in `avatar.js`), so a sustained head
turn is chased by a trunk that leaves late and settles late. Follow-through
falls out of the smoothing the rig already had; there is no second animation
system. Shorten it toward 0.16 and head and trunk move as one rigid piece, which
is the puppet read.

**Honour the channel's semantic, not its plumbing.** The value is what an author
of `visemes.js`/`emotions.js` — who never sees your renderer — thinks they are
asking for. The standing example: `mouthOpen` denotes the *visible aperture*.
peep initially mapped it to the gap between lip centrelines; the drawn lip band
was ~11 units thick, so the mouth stayed visibly shut until 0.25, and two of the
nine visemes live below that. The fix was to solve back from aperture to control
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

## Author review

Rig review is parameter-level verification. It does not mention states,
actions, Pipecat, or server messages.

An author reviews rest and channel extremes, meaningful extreme composites,
every viseme at full-frame and close scale, curated transitions (`X→A→X`,
`A→D→A`, `D→F→B`, `B→G→H`, and rapid closures), the same raw frame across
registered rigs, and numeric conformance (finite values, mounted renderer,
clean teardown). Studio's Rig routes implement this review.
