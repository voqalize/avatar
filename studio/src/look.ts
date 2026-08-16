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

/**
 * The three multipliers, named once so the sliders and their labels cannot
 * disagree.
 *
 * They were three unlabelled tracks reading `1.00` and nobody could tell what
 * any of them did, which is a fair complaint: `mouthGain` is a scale factor on
 * an internal channel group, and the only useful way to describe it is by what
 * you will see change on the face. So each names the part of the face it scales
 * and says what turning it costs — every one has a direction that makes the
 * avatar worse, which is the actual reason to touch it.
 */
export const GAINS = [
  [
    "mouthGain",
    "Mouth",
    "Viseme travel. Under 100% it mumbles, over it chews. Lipsync is the headline feature, so this is the one that ruins it.",
  ],
  [
    "gestureGain",
    "Gestures",
    "The authored moves — nods, receipts, the hand. Turn it down to check a nod still reads at all.",
  ],
  [
    "motionGain",
    "Idle motion",
    "Drift, blinks, breathing. Low by design: the avatar shares a screen with a camera feed, and jitter costs bitrate for nothing.",
  ],
] as const satisfies ReadonlyArray<readonly [keyof Look, string, string]>;
