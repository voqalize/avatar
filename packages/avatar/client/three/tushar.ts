/**
 * tushar — the second 3-D character, and the one who proved the factory.
 *
 * His GLB is the shared scripts run with his landmarks and atlas layout in
 * place of tara's (`characters/tushar/`, whose README has the provenance and
 * the commands). He was a deliberate copy of `tara.ts` for as long as there was
 * a `tara.ts` to copy; since 2026-09-23 there is one Blender entry point and he
 * is its second caller rather than her second draft (`createCharacter.ts`).
 *
 * He is also the face that turned the ledger from a question into a decision.
 * What was marked TARA-SPECIFIC was marked that way because one face cannot
 * tell a convention from a coincidence; he agreed with her, and so did the two
 * after him.
 */

import { character } from "./createCharacter.js";
import type { CharacterAvatarOptions } from "./createCharacter.js";
import { BLENDER_SUPPORTS } from "./sequences.js";
import { TUSHAR_GLB } from "./tushar-asset.js";

export type { CharacterAvatarOptions as AvatarOptions };
export type { AvatarInstance } from "./createCharacter.js";

/** The optional driving-UI declaration; one list for every Blender character
 *  (`sequences.ts`), because they are one rig. */
export const supports = BLENDER_SUPPORTS;

export const createAvatar = character("tushar", TUSHAR_GLB);
