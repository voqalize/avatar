/**
 * Renderer-agnostic frame types expressed as runtime helpers.
 *
 * `createSvgRig()` is a migration adapter for the existing SVG faces. It lets
 * the mixer submit one AvatarFrame per tick today while new renderers can
 * implement the same small `{ apply(frame), destroy() }` contract directly.
 */

export const HAND_GESTURE_NAMES = Object.freeze(['greet', 'farewell', 'approve', 'wait']);

/** @param {Record<string, number>} pose @param {object|undefined} hand */
export function avatarFrame(pose, hand) {
  return hand ? { pose, hand } : { pose };
}

/**
 * Adapt an existing SVG face plus its first-class hand renderer to AvatarRig.
 * `face` and `hand` retain their own SVG-private geometry; callers only submit
 * semantic frames.
 */
export function createSvgRig(face, hand = null) {
  return {
    apply(frame) {
      face.apply(frame.pose);
      if (hand && typeof hand.applyFrame === 'function') hand.applyFrame(frame.hand);
    },
    destroy() {
      if (hand) hand.destroy();
      face.destroy();
    },
  };
}
