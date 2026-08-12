/**
 * Affect is a separate axis from state.
 *
 * If emotion were folded into the state enum you'd need SPEAKING_WARM,
 * SPEAKING_CONCERNED, LISTENING_WARM ... and the table would be unmaintainable
 * within a week. Instead: `setState('LISTENING', { emotion: 'curious' })`. The
 * emotion contributes a base pose that every other layer builds on top of.
 */

export const EMOTIONS = {
  // Deliberately empty: REST is genuine availability, rather than a social
  // smile baked into every state. Positive affect belongs to a response,
  // greeting, success beat, or explicit warm/encouraging emotion.
  neutral: {},
  warm: {
    mouthCornerL: 0.48, mouthCornerR: 0.48,
    // A real smile squints. Without this it reads as a mask.
    squintL: 0.30, squintR: 0.30, lidL: 0.04, lidR: 0.04,
    browRaiseL: 0.10, browRaiseR: 0.10,
  },
  curious: {
    browRaiseL: 0.34, browRaiseR: 0.12,
    browAngleL: 0.10,
    headRoll: 0.07,
    mouthCornerL: 0.18, mouthCornerR: 0.14,
    lidL: -0.10, lidR: -0.10,
  },
  concerned: {
    browInnerL: 0.55, browInnerR: 0.55,
    browRaiseL: -0.08, browRaiseR: -0.08,
    mouthCornerL: -0.22, mouthCornerR: -0.22,
    lidL: 0.06, lidR: 0.06,
  },
  encouraging: {
    mouthCornerL: 0.58, mouthCornerR: 0.58,
    browRaiseL: 0.26, browRaiseR: 0.26,
    squintL: 0.22, squintR: 0.22,
    headPitch: 0.05,
  },
  thoughtful: {
    browRaiseL: -0.14, browRaiseR: -0.06,
    browInnerL: 0.18, browInnerR: 0.10,
    mouthPress: 0.45, mouthCornerL: -0.05, mouthCornerR: 0.02,
    lidL: 0.10, lidR: 0.10,
  },
};

export const EMOTION_NAMES = Object.keys(EMOTIONS);

/** Blend an emotion toward neutral by `intensity`. */
export function emotionPose(name, intensity = 1) {
  const src = EMOTIONS[name] || EMOTIONS.neutral;
  const out = {};
  for (const k in src) out[k] = src[k] * intensity;
  return out;
}
