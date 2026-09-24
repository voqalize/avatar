/**
 * tanvi — Indian, and the first character whose hair is not part of her head.
 *
 * Her GLB is the shared scripts run with her landmarks (`characters/tanvi/`).
 * Her long waves fall past both shoulders onto her chest, which a `Hair` shell
 * painted into the head's atlas cannot carry: it can only be where the head is.
 * So her photograph is split into her with the hair pulled back, which is what
 * every other script reads, and the hair alone, which becomes a `HairLayer`
 * mesh of its own — turning with the skull, holding back its share of a roll
 * like tanya's hanging hair, lifting with the shoulders below the chin, and
 * drawn over everything behind it (`character-rig.ts`).
 *
 * Her head angles have not been read off her yet. `motion-limits.json` says so
 * rather than guessing, and `headHold` gives her the tightest budget any face
 * is still vouched for until the owner drives her.
 */

import { character } from "./createCharacter.js";
import type { CharacterAvatarOptions } from "./createCharacter.js";
import { BLENDER_SUPPORTS } from "./sequences.js";
import { TANVI_GLB } from "./tanvi-asset.js";

export type { CharacterAvatarOptions as AvatarOptions };
export type { AvatarInstance } from "./createCharacter.js";

/** The optional driving-UI declaration; one list for every Blender character
 *  (`sequences.ts`), because they are one rig. */
export const supports = BLENDER_SUPPORTS;

export const createAvatar = character("tanvi", TANVI_GLB);
