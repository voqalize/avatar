/** Professional Indian male interviewer, authored to read at call-tile size. */

import { createCanvasAvatar } from './createCanvasAvatar.js';
import type { CanvasAvatarOptions } from './createCanvasAvatar.js';
import type { AvatarInstance } from './createAvatar.js';

const RIG_URL = new URL('../src/canvas/data/interviewer-male.rig.json', import.meta.url);
const IMAGES = {
  'round-m3-hair-back.webp': new URL('../src/canvas/data/img/round-m3-hair-back.webp', import.meta.url),
  'round-m3-top-body.webp': new URL('../src/canvas/data/img/round-m3-top-body.webp', import.meta.url),
  'round-m3-hair-front.webp': new URL('../src/canvas/data/img/round-m3-hair-front.webp', import.meta.url),
} as const;
const FACE = () => import('../src/canvas/avatars/round/face.mjs');

export type { CanvasAvatarOptions };

export function createAvatar(options: CanvasAvatarOptions): AvatarInstance {
  return createCanvasAvatar(options, {
    rigUrl: RIG_URL,
    images: IMAGES,
    face: FACE,
    label: 'Arjun — professional male interviewer avatar',
  });
}
