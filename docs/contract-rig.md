# Rig contract

This is the contract between an avatar renderer and the behavior library. It
is deliberately independent of SVG, WebGL, video, and any future rendering
technology. The rig renders; it does not decide what the avatar is doing.

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
