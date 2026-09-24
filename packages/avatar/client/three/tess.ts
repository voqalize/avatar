/**
 * tess — American, and the leanest character in the forge.
 *
 * Her GLB is the shared scripts run with her landmarks (`characters/tess/`,
 * whose README has the provenance and the commands). She is back inside tara's
 * atlas window — her hair is drawn into a low tail that clears both ears and
 * reaches |u| 0.492 against a window that stops at 0.64 — so unlike tanya she
 * needs no `face_texture.py` of her own, and her `Hair` shell gives up no roll:
 * nothing of hers hangs past the jaw to lag. One supplied sheet, no paid edit,
 * no module of her own; she is what a new character costs at the floor, which
 * is why the README builds its template from her.
 *
 * Her head angles have not been read off her yet. `motion-limits.json` says so
 * rather than guessing, and `headHold` gives her the tightest budget any face
 * is still vouched for until the owner drives her.
 */

import { character } from "./createCharacter.js";
import type { CharacterAvatarOptions } from "./createCharacter.js";
import { BLENDER_SUPPORTS } from "./sequences.js";
import { TESS_GLB } from "./tess-asset.js";

export type { CharacterAvatarOptions as AvatarOptions };
export type { AvatarInstance } from "./createCharacter.js";

/** The optional driving-UI declaration; one list for every Blender character
 *  (`sequences.ts`), because they are one rig. */
export const supports = BLENDER_SUPPORTS;

export const createAvatar = character("tess", TESS_GLB);
