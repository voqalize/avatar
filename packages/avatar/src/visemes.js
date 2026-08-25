/**
 * Visemes — the wire protocol between the server and the mouth.
 *
 * We use the Rhubarb Lip Sync alphabet (A–H, plus X for silence), which is a
 * condensation of the Preston Blair mouth set. Nine shapes is plenty for a
 * stylized 2D face, and it gives the server side an obvious open-source
 * reference implementation to target.
 *
 *   A  closed lips          P B M   (also the resting closure)
 *   B  slightly open,       K S T D, and consonantal EE
 *      teeth together
 *   C  open                 EH AE
 *   D  wide open            AA
 *   E  slightly rounded     AO ER
 *   F  puckered             UW OW W
 *   G  lip to upper teeth   F V
 *   H  tongue up            L
 *   X  idle / silence
 *
 * A cue is `{ t, v, i? }` — millisecond offset into the utterance, the letter,
 * and an optional 0..1 intensity (loudness). Intensity is cheap for the server
 * to derive from TTS energy and is the single biggest realism win available:
 * the same viseme shouted and murmured should not look identical.
 */

import {
  CUE_TRACK_LEAD_MS,
  MIN_VISIBLE_CUE_MS,
  SPEECH_TRACK_TAIL_MS,
} from './speech-timing.js';

export const VISEME_SHAPES = {
  X: { mouthOpen: 0.02, mouthWidth: 0.42, mouthRound: 0.10, mouthPress: 0.15, mouthTuck: 0, teethUpper: 0.00, tongue: 0.0 },
  A: { mouthOpen: 0.00, mouthWidth: 0.40, mouthRound: 0.18, mouthPress: 0.55, mouthTuck: 0, teethUpper: 0.00, tongue: 0.0 },
  B: { mouthOpen: 0.16, mouthWidth: 0.54, mouthRound: 0.05, mouthPress: 0.10, mouthTuck: 0, teethUpper: 0.75, tongue: 0.0 },
  C: { mouthOpen: 0.45, mouthWidth: 0.58, mouthRound: 0.05, mouthPress: 0.00, mouthTuck: 0, teethUpper: 0.45, tongue: 0.0 },
  D: { mouthOpen: 0.85, mouthWidth: 0.52, mouthRound: 0.02, mouthPress: 0.00, mouthTuck: 0, teethUpper: 0.25, tongue: 0.15 },
  E: { mouthOpen: 0.34, mouthWidth: 0.28, mouthRound: 0.55, mouthPress: 0.00, mouthTuck: 0, teethUpper: 0.15, tongue: 0.0 },
  F: { mouthOpen: 0.22, mouthWidth: 0.10, mouthRound: 0.95, mouthPress: 0.10, mouthTuck: 0, teethUpper: 0.00, tongue: 0.0 },
  G: { mouthOpen: 0.20, mouthWidth: 0.46, mouthRound: 0.10, mouthPress: 0.40, mouthTuck: 1.00, teethUpper: 1.00, tongue: 0.0 },
  H: { mouthOpen: 0.40, mouthWidth: 0.48, mouthRound: 0.05, mouthPress: 0.00, mouthTuck: 0, teethUpper: 0.35, tongue: 0.90 },
};

export const VISEME_LETTERS = Object.keys(VISEME_SHAPES);

/** Resting mouth used when nothing is speaking. */
export const SILENT = 'X';

/**
 * Scale a shape by loudness. Only the "effortful" channels scale — a quiet 'D'
 * is a small D, not a different shape.
 */
export function shapeFor(letter, intensity = 1) {
  const base = VISEME_SHAPES[letter] || VISEME_SHAPES[SILENT];
  const rest = VISEME_SHAPES.X;
  const k = 0.45 + 0.55 * Math.max(0, Math.min(1, intensity));
  return {
    mouthOpen: rest.mouthOpen + (base.mouthOpen - rest.mouthOpen) * k,
    mouthWidth: rest.mouthWidth + (base.mouthWidth - rest.mouthWidth) * k,
    mouthRound: base.mouthRound,
    mouthPress: base.mouthPress,
    mouthTuck: base.mouthTuck,
    teethUpper: base.teethUpper * k,
    tongue: base.tongue,
    jaw: (rest.mouthOpen + (base.mouthOpen - rest.mouthOpen) * k) * 0.7,
  };
}

// ---------------------------------------------------------------------------
// Cue track hygiene
// ---------------------------------------------------------------------------

/**
 * Sort, merge consecutive duplicates, and drop sub-perceptual cues. Servers
 * emit noisy tracks; this makes them watchable.
 */
export function normalizeCues(cues) {
  const out = [];
  const sorted = [...cues].sort((a, b) => a.t - b.t);
  for (const c of sorted) {
    const v = VISEME_SHAPES[c.v] ? c.v : SILENT;
    const prev = out[out.length - 1];
    if (prev && prev.v === v) continue; // merge repeats
    if (prev && c.t - prev.t < MIN_VISIBLE_CUE_MS) {
      // Too short to read. Keep whichever is more visually salient: a closure
      // (A/G) carries more lip-reading information than a mid-open vowel.
      if (v === 'A' || v === 'G') {
        // The short cue can sit between two identical closures (G → F → G).
        // Its replacement would otherwise create a duplicate visible shape;
        // preserving the first G is both the stable wire form and the face the
        // viewer actually saw.
        if (out.length > 1 && out[out.length - 2].v === v) out.pop();
        // A winning closure replaces the preceding shape for the entire
        // sub-perceptual interval. Preserve that cue's timestamp while taking
        // the closure's intensity, matching the server-side wire normalizer.
        else out[out.length - 1] = { ...c, t: prev.t, v };
      }
      continue;
    }
    out.push({ t: c.t, v, i: c.i == null ? 1 : c.i });
  }
  return out;
}

/**
 * Schedules a cue track against an utterance clock.
 *
 * An audio-owned clock (`audioEl.currentTime * 1000` or
 * `AudioContext.currentTime`) is the strongest source when the caller owns
 * playback. The Pipecat adapter cannot see browser device playout; it supplies
 * elapsed time from `botStartedSpeaking`, Pipecat's output-lifecycle epoch.
 *
 * There is deliberately no renderer-wide lead. Network/media skew cannot be
 * corrected by moving every cue, and the predicted backend leg owns its own
 * explicit prediction cushion.
 */
export const LEAD_MS = CUE_TRACK_LEAD_MS;

export class VisemeTrack {
  constructor() {
    this.cues = [];
    this.clock = null;
    this.playing = false;
    this._idx = 0;
    this.onEnd = null;
    this.tailMs = SPEECH_TRACK_TAIL_MS;
  }

  /** @param {() => number} clock returns elapsed ms of the audio being played */
  start(cues, clock) {
    this.cues = normalizeCues(cues);
    this.clock = clock;
    this._idx = 0;
    this.playing = true;
  }

  /** Streaming top-up: append cues that arrive mid-utterance. */
  push(cues) {
    const merged = normalizeCues([...this.cues, ...cues]);
    this.cues = merged;
    // Re-seek rather than trusting the old index against a re-normalized array.
    this._idx = 0;
  }

  stop() {
    this.playing = false;
    this.cues = [];
    this.clock = null;
    this._idx = 0;
  }

  /** @returns {{letter: string, intensity: number} | null} */
  sample() {
    if (!this.playing || !this.cues.length || !this.clock) return null;
    const now = this.clock() + LEAD_MS;

    // Cues are time-ordered and `now` is mostly monotonic, so this walk is O(1)
    // amortized. Reset on seek-backward.
    if (this._idx > 0 && this.cues[this._idx] && this.cues[this._idx].t > now) this._idx = 0;
    while (this._idx + 1 < this.cues.length && this.cues[this._idx + 1].t <= now) this._idx++;

    const last = this.cues[this.cues.length - 1];
    if (now > last.t + this.tailMs && last.v === SILENT) {
      this.playing = false;
      if (this.onEnd) this.onEnd();
      return null;
    }

    const cue = this.cues[this._idx];
    if (cue.t > now) return { letter: SILENT, intensity: 1 };
    return { letter: cue.v, intensity: cue.i == null ? 1 : cue.i };
  }
}

// ---------------------------------------------------------------------------
// Reference mappings for the server side
// ---------------------------------------------------------------------------

/**
 * ARPAbet phoneme -> Rhubarb letter. This is the table to port server-side if
 * you go the forced-alignment / G2P route (CMUdict, phonemizer, MFA).
 */
export const ARPABET_TO_VISEME = {
  // closures
  P: 'A', B: 'A', M: 'A',
  // labiodental
  F: 'G', V: 'G',
  // rounded
  W: 'F', UW: 'F', UH: 'F', OW: 'F', OY: 'F',
  AO: 'E', ER: 'E', AXR: 'E', R: 'E',
  // tongue-up
  L: 'H',
  // wide-open vowels
  AA: 'D', AY: 'D', AW: 'D',
  AE: 'C', AH: 'C', EH: 'C', EY: 'C', HH: 'C',
  IH: 'B', IY: 'B', Y: 'B',
  // alveolars / sibilants / the rest
  T: 'B', D: 'B', S: 'B', Z: 'B', N: 'B', K: 'B', G: 'B', NG: 'B',
  SH: 'B', ZH: 'B', CH: 'B', JH: 'B', TH: 'B', DH: 'B',
  SIL: 'X', SP: 'X',
};

/**
 * Azure Speech emits integer viseme IDs (0-21) on its `visemeReceived` event.
 * This maps them straight onto our letters — the cheapest possible path to
 * production-quality lipsync if you're already on Azure TTS.
 */
export const AZURE_VISEME_TO_LETTER = [
  'X', 'C', 'D', 'E', 'C', 'E', 'B', 'F', 'F', 'D',
  'E', 'D', 'C', 'E', 'H', 'B', 'B', 'B', 'G', 'B',
  'B', 'A',
];

/**
 * A crude grapheme-level guesser. NOT for production — it exists so the demo
 * can preview arbitrary text without a TTS round-trip, and to make the shape of
 * the mapping concrete. Real timing must come from the server.
 */
export function textToCues(text, { wpm = 165 } = {}) {
  const msPerChar = 60000 / (wpm * 5.1);
  const cues = [];
  let t = 0;
  const s = text.toLowerCase();
  const push = (v, dur) => { cues.push({ t: Math.round(t), v }); t += dur; };

  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    const c = s[i];
    if (two === 'th' || two === 'sh' || two === 'ch') { push('B', msPerChar * 1.6); i++; continue; }
    if (two === 'oo' || two === 'ou' || two === 'ow') { push('F', msPerChar * 1.8); i++; continue; }
    if (two === 'ee' || two === 'ea') { push('B', msPerChar * 1.7); i++; continue; }
    if (/[pbm]/.test(c)) push('A', msPerChar * 1.1);
    else if (/[fv]/.test(c)) push('G', msPerChar * 1.2);
    else if (/[wu]/.test(c)) push('F', msPerChar * 1.4);
    else if (/[or]/.test(c)) push('E', msPerChar * 1.4);
    else if (c === 'l') push('H', msPerChar * 1.2);
    else if (/[ai]/.test(c)) push('D', msPerChar * 1.5);
    else if (/[e]/.test(c)) push('C', msPerChar * 1.4);
    else if (/[a-z]/.test(c)) push('B', msPerChar);
    else if (/[\s]/.test(c)) push('X', msPerChar * 0.9);
    else if (/[,;:]/.test(c)) push('X', 180);
    else if (/[.!?]/.test(c)) push('X', 320);
  }
  push('X', 0);
  return cues;
}
