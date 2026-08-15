/**
 * Everything `createAvatar` takes besides the mount and the client.
 *
 * The three faces are imported as values, one per module — the same three lines
 * a consumer writes. There is no name→face table in the library and Studio does
 * not reach for `src/faces.js` to get one: that module is tooling, and a
 * picker's need to render a list is not a reason for the package to carry every
 * drawing in every bundle. Three imports here is what it costs to offer three,
 * and it is the honest cost.
 */

import type { Face, Gain, HandSide } from "@voqalize/avatar";
import { peep } from "@voqalize/avatar/faces/peep";
import { wren } from "@voqalize/avatar/faces/wren";
import { myna } from "@voqalize/avatar/faces/myna";

export const FACES = { peep, wren, myna } as const;
export type FaceName = keyof typeof FACES;
export const FACE_NAMES = Object.keys(FACES) as FaceName[];

export const isFaceName = (value: string): value is FaceName => value in FACES;

/** The option surface, as one value, so a change to any of it is one remount. */
export interface Look {
  face: FaceName;
  mouthGain: Gain;
  gestureGain: Gain;
  motionGain: Gain;
  hand: boolean;
  handSide: HandSide;
}

/** `peep` is `DEFAULT_FACE` and the rig to author against (CLAUDE.md). */
export const DEFAULT_LOOK: Look = {
  face: "peep",
  mouthGain: 1,
  gestureGain: 1,
  motionGain: 1,
  hand: true,
  handSide: 1,
};

export const faceValue = (name: FaceName): Face => FACES[name];

/** The gains, named once, so the sliders and the labels cannot disagree. */
export const GAINS = [
  ["mouthGain", "Mouth", "Viseme amplitude. Lipsync is the headline feature; this is the knob that ruins it."],
  ["gestureGain", "Gesture", "Clip amplitude — nods, receipts, the hand."],
  ["motionGain", "Motion", "Idle liveness. Low by design: a jittery face costs the encoder real bitrate."],
] as const satisfies ReadonlyArray<readonly [keyof Look, string, string]>;
