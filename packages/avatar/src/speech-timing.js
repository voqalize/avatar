/**
 * Timing policy for the mouth track.
 *
 * Keep perceptual cleanup, cue presentation, and mouth response constants
 * named by their job. Network delivery is deliberately absent: it cannot be
 * corrected by shifting every cue on the utterance clock.
 */

/** Cues shorter than this do not survive visual normalization. */
export const MIN_VISIBLE_CUE_MS = 30;

/** Cue timestamps render verbatim; the clock's epoch is supplied by the caller. */
export const CUE_TRACK_LEAD_MS = 0;

/** Extra time after a final silence cue before a general speech track ends. */
export const SPEECH_TRACK_TAIL_MS = 120;

/** Shorter completion tail for self-contained spoken interjection clips. */
export const INTERJECTION_TRACK_TAIL_MS = 60;

/** First-order response constants: lips settle before the jaw does. */
export const MOUTH_RESPONSE_TAU_S = 0.042;
export const JAW_RESPONSE_TAU_S = 0.07;
