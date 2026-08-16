import type { Face } from "./avatar.js";

export const peep: Face;
export const wren: Face;
export const myna: Face;

/** The faces we ship. Not an open vocabulary — a third face is a code change. */
export type FaceName = "peep" | "wren" | "myna";

export const FACES: Readonly<Record<FaceName, Face>>;
export const FACE_NAMES: readonly FaceName[];
export const DEFAULT_FACE: FaceName;
