/**
 * tanya — the third 3-D character, and the first whose atlas is not tara's
 * window.
 *
 * Her GLB is the shared scripts run with her landmarks and atlas layout
 * (`characters/tanya/`, whose README has the provenance and the commands).
 * Her hair is the silhouette down past the jaw, out to |u| 0.761 where tara's
 * window stops at 0.64, so `characters/tanya/face_texture.py` widens it to
 * 1408x1568 at the same 800 pixels per face height. That is a fact about the
 * asset and costs this file nothing — the rig reads the window from the GLB.
 *
 * Hair that hangs is what else makes her the third rather than a fourth copy:
 * hers is the only `Hair` mesh that carries the roll channels, because it is
 * the only one with anything below the hold line to lag behind a tilt.
 */

import { character } from "./createCharacter.js";
import type { CharacterAvatarOptions } from "./createCharacter.js";
import { BLENDER_SUPPORTS } from "./sequences.js";
import { TANYA_GLB } from "./tanya-asset.js";

export type { CharacterAvatarOptions as AvatarOptions };
export type { AvatarInstance } from "./createCharacter.js";

/** The optional driving-UI declaration; one list for every Blender character
 *  (`sequences.ts`), because they are one rig. */
export const supports = BLENDER_SUPPORTS;

export const createAvatar = character("tanya", TANYA_GLB);
