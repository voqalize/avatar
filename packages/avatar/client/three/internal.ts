/**
 * The 2.5-D rig, below the `createAvatar` modules — `/internal`, no semver promise.
 *
 * A character's own module — `tara.ts`, `tushar.ts`, `tanya.ts`, `tess.ts` — is
 * what a consumer gets: one `createAvatar` each, the mixer behind it, nothing to
 * configure. This is the other door, for a page whose subject is the *rig*
 * rather than the call — the renderer with no mixer in front of it, every
 * compiled character, and the head envelope their channels are scaled by. Its readers are the rig instruments
 * in the working tree, and nothing that ships.
 *
 * It exists because those instruments were reaching around the package instead,
 * by relative path into its source, and two of them carried their own copy of
 * the head envelope — with a comment saying the copy would quietly lie the day
 * the envelope moved. It moved on 2026-09-18. One export is cheaper than that
 * warning, and it is the same `/internal` spelling this package already uses for
 * the mixer.
 */
export { ASSETS as CHARACTERS } from "./assets.js";
export type { CharacterName } from "./assets.js";

export { createTaraRig, EYE_DEG, HEAD_CLAMP, HEAD_DEG, TARA_TUNING } from "./tara-rig.js";
export type { TaraRigOptions } from "./tara-rig.js";
export { HARD_BUDGET, pixelRatioFor, SHIPPING_SURFACE } from "./budgets.js";

/**
 * The authored motion tables these characters are driven by.
 *
 * `tara.ts` and its siblings hand them to the mixer and nobody else sees them,
 * which is right for a consumer: a face's clips are not a configuration. An
 * instrument that drives the mixer directly — a scripted take, where the script
 * *is* the server — needs the same two tables, and the alternative was a
 * relative import into the package's own source of the kind this file exists to
 * end.
 */
export { BLENDER_ACTIONS, BLENDER_SEQUENCES, BLENDER_SUPPORTS } from "./sequences.js";

/**
 * The head budget each character is driven under, and the measurements it comes
 * from.
 *
 * An instrument that watches a character move has to mount the *shipping*
 * character or it is watching something else, and `headHold` is the one option
 * `tara.ts` passes that a lab page would otherwise have to guess at — the
 * budget is load-bearing, not a margin: speech asks for about nine degrees of
 * yaw before it trims one. The limits themselves come along because a page that
 * plots degrees has to draw the band, and reading it out of the same file the
 * budget is derived from is the only way the two cannot disagree.
 *
 * Read-only, both of them. Nothing here recomputes a measured angle
 * (`holds.ts`).
 */
export { headHold } from "./holds.js";
export type { HeadHold } from "./holds.js";
export { default as MOTION_LIMITS } from "./motion-limits.json" with { type: "json" };
