/** Professional Indian female interviewer, authored to read at call-tile size. */

import { createCanvasAvatar } from './createCanvasAvatar.js';
import type { InterviewerAvatarOptions } from './createCanvasAvatar.js';
import type { AvatarInstance } from './createAvatar.js';

const RIG_URL = new URL('../src/canvas/data/interviewer-female.rig.json', import.meta.url);
const IMAGES = {
  'round-w1-hair-back.webp': new URL('../src/canvas/data/img/round-w1-hair-back.webp', import.meta.url),
  'round-w1-top-body.webp': new URL('../src/canvas/data/img/round-w1-top-body.webp', import.meta.url),
  'round-w1-hair-front.webp': new URL('../src/canvas/data/img/round-w1-hair-front.webp', import.meta.url),
} as const;
const FACE = () => import('../src/canvas/avatars/round/face.mjs');

export type { InterviewerAvatarOptions };

export function createAvatar(options: InterviewerAvatarOptions): AvatarInstance {
  return createCanvasAvatar(options, {
    rigUrl: RIG_URL,
    images: IMAGES,
    face: FACE,
    label: 'Professional female interviewer avatar',
  });
}
