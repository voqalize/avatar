/** Renderer-neutral rig contract; see docs/contract-rig.md. */
export type RigChannel = string;
export type RigPose = Readonly<Record<RigChannel, number>>;

export interface HandFrame {
  gesture: "greet" | "farewell" | "approve" | "wait";
  progress: number;
  side: "left" | "right";
}

export interface AvatarFrame {
  pose: RigPose;
  hand?: HandFrame;
}

export interface AvatarRig {
  apply(frame: AvatarFrame): void;
  destroy(): void;
}

export type AvatarRigFactory = (mount: HTMLElement, options?: unknown) => AvatarRig;

export const HAND_GESTURE_NAMES: ReadonlyArray<HandFrame["gesture"]>;
export function avatarFrame(pose: RigPose, hand?: HandFrame): AvatarFrame;
