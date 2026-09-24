/**
 * How far each character may hold its head off centre, as the mixer wants it:
 * pose units per axis, ready to hand to `createSvgAvatar` as `headHold`.
 *
 * The angles themselves are in `motion-limits.json` and are only
 * there. They were read off the faces by the person who owns how they
 * look, one axis at a time, at the surface a call actually shows — which is
 * the only way this kind of number can be got, and the reason nothing here
 * recomputes, adjusts or second-guesses one. This file is the unit change and
 * nothing else.
 *
 * An axis the file never carried is the same case, and a character built but
 * not yet driven by the owner has none of them: the file says so instead of
 * carrying a number nobody read, and the fallback below is what holds her.
 *
 * An axis the file marks for re-measurement is not enforced: it was read off an
 * asset that has since been fixed, and holding the driver to a defect that no
 * longer exists is worse than the defect. It falls back to the tightest angle
 * still live on that axis across the other characters instead of falling out of
 * the budget altogether, which is what it used to do. That is not a way of
 * believing the stale number by the back door — it is the same budget the
 * faces nobody has any doubt about are already held to. Dropping the axis made
 * the one face nobody can currently vouch for the only one driven with no
 * budget at all, and speech asks for about nine degrees of yaw before a budget
 * trims it.
 */

import LIMITS from "./motion-limits.json" with { type: "json" };
import { HEAD_CLAMP, HEAD_DEG } from "./character-rig.js";

/** Degrees of each axis per pose unit, which is `HEAD_DEG` at the clamp. */
const PER_UNIT = {
  headYaw: HEAD_DEG.yaw / HEAD_CLAMP,
  headPitch: HEAD_DEG.pitch / HEAD_CLAMP,
  headRoll: HEAD_DEG.roll / HEAD_CLAMP,
} as const;

const AXIS = { headYaw: "yaw", headPitch: "pitch", headRoll: "roll" } as const;

export type HeadHold = Partial<Record<keyof typeof AXIS, number>>;

type Measured = { safe: number; remeasure?: string };

/** What the file says about one character's axis, if it says anything live. */
const live = (name: string, axis: string): Measured | undefined => {
  const measured = (LIMITS.characters as Record<string, Record<string, unknown>>)[name];
  const entry = measured?.[axis] as Measured | undefined;
  return entry && !entry.remeasure ? entry : undefined;
};

/** The tightest angle any character is still vouched for on this axis. */
function safest(axis: string): number | undefined {
  const angles = Object.keys(LIMITS.characters)
    .map((name) => live(name, axis)?.safe)
    .filter((deg): deg is number => deg !== undefined);
  return angles.length ? Math.min(...angles) : undefined;
}

/** `name` as the limits file spells it — a character with no live axis there
 *  is held to the tightest budget any other is still vouched for. */
export function headHold(name: keyof typeof LIMITS.characters): HeadHold {
  const out: HeadHold = {};
  for (const channel of Object.keys(AXIS) as (keyof typeof AXIS)[]) {
    const axis = AXIS[channel];
    const deg = live(name, axis)?.safe ?? safest(axis);
    if (deg !== undefined) out[channel] = deg / PER_UNIT[channel];
  }
  return out;
}
