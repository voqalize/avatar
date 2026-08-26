/**
 * Everything `createAvatar` takes besides the mount and the client.
 *
 * Studio imports every identity explicitly, exactly as a consumer would. The
 * three SVG drawings arrive as face values; the professional canvas identities
 * arrive as complete `createAvatar` modules. There is no package registry and
 * no reach into `src/` or `/internal`.
 */

import { createAvatar as createSvgAvatar } from "@voqalize/avatar";
import type { AvatarInstance, Face, Gain, HandSide } from "@voqalize/avatar";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { peep } from "@voqalize/avatar/faces/peep";
import { wren } from "@voqalize/avatar/faces/wren";
import { myna } from "@voqalize/avatar/faces/myna";
import { createAvatar as createArjun } from "@voqalize/avatar/avatars/arjun";
import { createAvatar as createMeera } from "@voqalize/avatar/avatars/meera";
import { createAvatar as createVikram } from "@voqalize/avatar/avatars/vikram";
import { createAvatar as createIshita } from "@voqalize/avatar/avatars/ishita";
import { createAvatar as createKabir } from "@voqalize/avatar/avatars/kabir";
import { createAvatar as createNaina } from "@voqalize/avatar/avatars/naina";

export const FACES = { peep, wren, myna } as const;
export type SvgAvatarName = keyof typeof FACES;
export const CANVAS_AVATAR_NAMES = ["arjun", "meera", "vikram", "ishita", "kabir", "naina"] as const;
export type CanvasAvatarName = (typeof CANVAS_AVATAR_NAMES)[number];
export type AvatarName = SvgAvatarName | CanvasAvatarName;
export const AVATAR_NAMES: readonly AvatarName[] = ["peep", "wren", "myna", ...CANVAS_AVATAR_NAMES];

/** The option surface, as one value, so a change to any of it is one remount. */
export interface Look {
  avatar: AvatarName;
  mouthGain: Gain;
  gestureGain: Gain;
  motionGain: Gain;
  hand: boolean;
  handSide: HandSide;
}

/** `peep` is `DEFAULT_FACE` and the rig to author against (CLAUDE.md). */
export const DEFAULT_LOOK: Look = {
  avatar: "peep",
  mouthGain: 1,
  gestureGain: 1,
  motionGain: 1,
  hand: true,
  handSide: 1,
};

const isSvgAvatar = (name: AvatarName): name is SvgAvatarName => name in FACES;

const CANVAS_CREATORS: Record<CanvasAvatarName, typeof createArjun> = {
  arjun: createArjun,
  meera: createMeera,
  vikram: createVikram,
  ishita: createIshita,
  kabir: createKabir,
  naina: createNaina,
};

export function createLookAvatar(
  look: Look,
  mount: HTMLElement,
  client: PipecatClient,
): AvatarInstance {
  const gains = {
    mount,
    client,
    mouthGain: look.mouthGain,
    gestureGain: look.gestureGain,
    motionGain: look.motionGain,
  };
  if (!isSvgAvatar(look.avatar)) return CANVAS_CREATORS[look.avatar](gains);
  return createSvgAvatar({
    ...gains,
    face: FACES[look.avatar] as Face,
    hand: look.hand,
    handSide: look.handSide,
  });
}

export const hasConfigurableHand = (name: AvatarName): boolean => isSvgAvatar(name);

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
