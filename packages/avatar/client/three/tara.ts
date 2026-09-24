/**
 * tara — the first 3-D character, as a complete `createAvatar` module.
 *
 * Structurally this is the canvas avatars' shape, one layer down: the mixer
 * (`@voqalize/avatar/internal`) does states, layers, gaze, idle, blinks, clips
 * and per-channel smoothing exactly as it does for every SVG face, and the only
 * thing a Blender character replaces is the renderer at the end of it. That is
 * the whole argument for authoring her morph targets under the library's pose
 * channel names: nothing above this line knows there is a GPU involved, and
 * every clip, viseme and co-articulation rule the SVG faces have works here
 * unmodified.
 *
 * How a Blender character is driven is `createCharacter.ts`, and it is the same
 * for all of them. What is hers is the mesh — and, until 2026-09-23, rather
 * more than that: this file was the original, the others were copies of it, and
 * the performance every character inherits was measured on her face. It is the
 * house performance now (`CHARACTER_TUNING`), which changes nothing about how
 * she looks and everything about where it is decided.
 *
 * The Three.js import lives behind this module rather than in the barrel so an
 * SVG or Canvas consumer never downloads it.
 */

import { character } from "./createCharacter.js";
import type { CharacterAvatarOptions } from "./createCharacter.js";
import { BLENDER_SUPPORTS } from "./sequences.js";
import { TARA_GLB } from "./tara-asset.js";

export type { CharacterAvatarOptions as AvatarOptions };
export type { AvatarInstance } from "./createCharacter.js";

/** The optional driving-UI declaration; one list for every Blender character
 *  (`sequences.ts`), because they are one rig. */
export const supports = BLENDER_SUPPORTS;

export const createAvatar = character("tara", TARA_GLB);
