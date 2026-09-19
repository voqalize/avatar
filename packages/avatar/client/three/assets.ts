/**
 * The three compiled characters as one table — for a page that enumerates them.
 *
 * Each URL lives in its own module (`tara-asset.ts` and its siblings) and this
 * file only gathers them, because a bundler emits assets per module: anything
 * importing *this* ships all three GLBs, which is right for a rig instrument
 * that switches between characters and wrong for a consumer who mounted one.
 * So the character modules never import this — they import their own — and the
 * only reader is `/internal/three`, a separate entry point that ships nothing.
 */
import { TANYA_GLB } from "./tanya-asset.js";
import { TARA_GLB } from "./tara-asset.js";
import { TUSHAR_GLB } from "./tushar-asset.js";

export const ASSETS = Object.freeze({
  tara: TARA_GLB,
  tushar: TUSHAR_GLB,
  tanya: TANYA_GLB,
});

/** Every compiled character, in build order. */
export type CharacterName = keyof typeof ASSETS;
