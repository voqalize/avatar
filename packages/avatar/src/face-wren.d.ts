import type { AvatarMeta, Face, FaceFactory } from "./avatar.js";

export const createFace: FaceFactory;
export const META: AvatarMeta;
/** Default palette. Passed as `createAvatar({ theme })`; see authoring-a-face.md. */
export const THEME: Readonly<Record<string, string>>;
export const wren: Face;
