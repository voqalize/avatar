/** Relaxed professional male avatar, authored to read at call-tile size. */

import { createCanvasAvatar } from './createCanvasAvatar.js';
import type { CanvasAvatarOptions } from './createCanvasAvatar.js';
import type { AvatarInstance } from './createAvatar.js';

const RIG_URL = new URL('../src/canvas/data/professional-male-b.rig.json', import.meta.url);
const IMAGES = {
  'professional-male-b-top-body.webp': new URL('../src/canvas/data/img/professional-male-b-top-body.webp', import.meta.url),
  'professional-male-b-hair-back.webp': new URL('../src/canvas/data/img/professional-male-b-hair-back.webp', import.meta.url),
  'professional-male-b-hair-front.webp': new URL('../src/canvas/data/img/professional-male-b-hair-front.webp', import.meta.url),
} as const;
const FACE = () => import('../src/canvas/avatars/round/face.mjs');

export type { CanvasAvatarOptions };

export function createAvatar(options: CanvasAvatarOptions): AvatarInstance {
  return createCanvasAvatar(options, {
    rigUrl: RIG_URL,
    images: IMAGES,
    face: FACE,
    label: 'Kabir — relaxed professional male avatar',
  });
}
