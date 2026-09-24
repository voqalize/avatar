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

/**
 * How far past touching a bilabial aims the lips, in `mouthOpen`.
 *
 * Lips do not ease into a closure; they arrive near their peak speed and
 * compress, because the target they are sent to is a *negative* aperture —
 * the lips would pass through each other if they could (Löfqvist & Gracco
 * 1997, JSLHR 40:877). A first-order chase aimed at zero never touches: it
 * slows to nothing on the way in, and a short [b] in running speech ends with
 * the lips still apart and the teeth showing through the gap. Aimed past
 * zero, the chase crosses it at speed and the drawn aperture stops at shut.
 *
 * The literature gives the direction, not a size in these units. This is the
 * knee measured on the Studio lipsync takes (both engines, the mouth modelled
 * at `MOUTH_RESPONSE_TAU_S`): at 0.1 some bilabials still stopped short, at
 * 0.2 all but a stray one met, and 0.3 met no more. From an ordinary open
 * vowel it touches in τ·ln((0.44 + 0.2) / 0.2) ≈ 49 ms.
 */
export const LIP_CONTACT_AIM = 0.2;

/**
 * How far ahead of a rounded vowel the lips begin to round. Anticipatory
 * rounding is among the longest-range coarticulation there is — 100–300 ms
 * before an audible [y]/[u] (Schwartz & Savariaux 2014) — and this is the
 * bottom of that range, because running speech compresses it and a pucker
 * spread across a whole preceding word reads as a pout.
 */
export const ROUND_LEAD_MS = 100;
