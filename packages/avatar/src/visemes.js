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
 * A cue is `{ t, v, i?, p? }` — millisecond offset into the utterance, the
 * letter, an optional 0..1 intensity (loudness): the same viseme shouted and
 * murmured should not look identical, and an optional phone label. The backend
 * measures `i` from the RMS under each cue, but only on the leg that has audio
 * to measure — a predicted cue describes speech nobody has generated yet, so it
 * arrives without one and is read here as 1.
 *
 * `p` is the phone being articulated under the letter, and the nine letters are
 * a lossy projection of it: `B` above lists four phone families and absorbs
 * fourteen more. Nothing in this file reads it — `VISEME_SHAPES` is the mouth
 * every face owes the server and it is keyed by letter. It rides through
 * normalization and out of `sample()` so that a rig with a finer mouth than
 * nine shapes can use it without the server sending a second track, and so that
 * a rig without one is unaffected.
 */

import {
  CUE_TRACK_LEAD_MS,
  MIN_VISIBLE_CUE_MS,
  ROUND_LEAD_MS,
  SPEECH_TRACK_TAIL_MS,
} from './speech-timing.js';

/**
 * The mouth every face owes the server, at the loudest a cue can say (`i` 1).
 *
 * **The apertures are measured speech, not taste.** The anchor is the open
 * vowel: Huber & Chandrasekaran 2006 (JSLHR 49:1368, Table 2; Optotrak, 30
 * adults, a sentence read aloud) open "Bobby"'s [ɑ] by 7.84 mm of lower lip
 * over the jaw, 7.32 of jaw and 2.49 of upper lip — 17.65 mm of inter-lip
 * opening, pooled over one comfortable and three loud conditions. Their Table 1
 * puts comfortable at 0.83 of that pool (4.86 mm against a loud 6.06–6.35), so
 * ordinary speech opens an [ɑ] **14.6 mm**, and `D` is sized so that it does at
 * `i` 0.5 — which is where PyGato puts an engine's ordinary speaking level
 * (`pygato.lipsync.intensity`). The same paper is the check on the parts this
 * does not set: the jaw's share comes out at 6.6 mm against their ~6.1, and the
 * upper lip at 1.7 mm against ~2.1 — the upper lip is the stable one, a third
 * of the lower's travel, and the rig already had it so.
 *
 * Millimetres are face units at **176.7 mm** a unit (chin to hairline): Lin &
 * Chen 2017 (PLoS ONE 12:e0188638) give women's menton–sellion as 107.8 mm,
 * and sellion sits at 0.61 of the unit on every character here. Their mouth
 * width (44.9 mm) would say 157 — these faces are drawn with slightly wide
 * mouths, and the vertical measure is the one an aperture is.
 *
 * No source reachable gave per-vowel apertures in millimetres, so the other
 * letters keep the ratios to `D` they were authored with and are scaled by the
 * same factor (0.617 of their excursion from rest). Upper-teeth show is part
 * of the opening and scales with it — except on `G`, where teeth on the lip
 * *is* the shape. A mouth this size is what "the mouth is moving a lot" was
 * asking for: the table it replaced opened an ordinary [ɑ] 26 mm, as far as the
 * loud speech in that study opens a shout.
 */
export const VISEME_SHAPES = {
  X: { mouthOpen: 0.02, mouthWidth: 0.42, mouthRound: 0.10, mouthPress: 0.15, mouthTuck: 0, teethUpper: 0.00, tongue: 0.0 },
  A: { mouthOpen: 0.00, mouthWidth: 0.40, mouthRound: 0.18, mouthPress: 0.55, mouthTuck: 0, teethUpper: 0.00, tongue: 0.0 },
  B: { mouthOpen: 0.11, mouthWidth: 0.54, mouthRound: 0.05, mouthPress: 0.10, mouthTuck: 0, teethUpper: 0.46, tongue: 0.0 },
  C: { mouthOpen: 0.29, mouthWidth: 0.58, mouthRound: 0.05, mouthPress: 0.00, mouthTuck: 0, teethUpper: 0.28, tongue: 0.0 },
  D: { mouthOpen: 0.53, mouthWidth: 0.52, mouthRound: 0.02, mouthPress: 0.00, mouthTuck: 0, teethUpper: 0.15, tongue: 0.15 },
  E: { mouthOpen: 0.22, mouthWidth: 0.28, mouthRound: 0.55, mouthPress: 0.00, mouthTuck: 0, teethUpper: 0.09, tongue: 0.0 },
  F: { mouthOpen: 0.14, mouthWidth: 0.10, mouthRound: 0.95, mouthPress: 0.10, mouthTuck: 0, teethUpper: 0.00, tongue: 0.0 },
  G: { mouthOpen: 0.13, mouthWidth: 0.46, mouthRound: 0.10, mouthPress: 0.40, mouthTuck: 1.00, teethUpper: 1.00, tongue: 0.0 },
  H: { mouthOpen: 0.25, mouthWidth: 0.48, mouthRound: 0.05, mouthPress: 0.00, mouthTuck: 0, teethUpper: 0.22, tongue: 0.90 },
};

export const VISEME_LETTERS = Object.keys(VISEME_SHAPES);

/** Resting mouth used when nothing is speaking. */
export const SILENT = 'X';

/** The shapes that are a contact, not an aperture: lips together, lip to teeth. */
const CLOSURES = new Set(['A', 'G']);

/**
 * How far the mandible falls for a given aperture — `jaw` is "follows
 * mouthOpen but slower" (`params.js`) and this is the slower.
 *
 * It is exported because it is not a preference: **every amplitude behind the
 * lips was calibrated at this ratio**, so a driver that picks its own moves the
 * mandible relative to the lip that hides it. The lower arch is the surface
 * that shows it, because it rides `jaw` alone while the lip peels off it on
 * `mouthOpen`: what is seen of the arch is the difference between two much
 * larger travels (`avatar-3d/scripts/morphs.ARCH_DROP`), so it goes to nothing
 * at a ratio only a little above this one. A face driven at 1:1 opens wide and
 * shows no lower teeth at any aperture — the arch descends as fast as the lip
 * uncovering it, which is what mocap did until it read this number instead of
 * ARKit's `jawOpen` directly.
 */
export const JAW_OF_OPEN = 0.7;

/**
 * How much of a shape's excursion a cue's loudness buys, as `k = LOUDNESS_FLOOR
 * + (1 - LOUDNESS_FLOOR) * i`.
 *
 * Louder speech is the same movement made bigger, and not by much: +10 dB
 * opens the lips and jaw 1.28x as far (Huber & Chandrasekaran 2006, Table 1:
 * 4.86 mm comfortable, 6.06–6.35 loud; Schulman 1989 calls it "amplification
 * of normal movement patterns"). `i` spans 16 dB with ordinary speech at 0.5,
 * so 0.5 either side is 8 dB and 1.22x — k runs 0.776 : 1 : 1.224 across it,
 * which normalised to the loud end is this floor. The quiet side is the loud
 * side's slope extended; nothing measured it.
 */
const LOUDNESS_FLOOR = 0.634;

/**
 * Scale a shape by loudness. Only the "effortful" channels scale — a quiet 'D'
 * is a small D, not a different shape.
 */
export function shapeFor(letter, intensity = 1) {
  const base = VISEME_SHAPES[letter] || VISEME_SHAPES[SILENT];
  const rest = VISEME_SHAPES.X;
  const k = LOUDNESS_FLOOR + (1 - LOUDNESS_FLOOR) * Math.max(0, Math.min(1, intensity));
  return {
    mouthOpen: rest.mouthOpen + (base.mouthOpen - rest.mouthOpen) * k,
    mouthWidth: rest.mouthWidth + (base.mouthWidth - rest.mouthWidth) * k,
    mouthRound: base.mouthRound,
    mouthPress: base.mouthPress,
    mouthTuck: base.mouthTuck,
    teethUpper: base.teethUpper * k,
    tongue: base.tongue,
    jaw: (rest.mouthOpen + (base.mouthOpen - rest.mouthOpen) * k) * JAW_OF_OPEN,
  };
}

// ---------------------------------------------------------------------------
// Cue track hygiene
// ---------------------------------------------------------------------------

/**
 * Group a time-ordered cue list into runs that share a mouth shape.
 *
 * A backend emits one cue per intersection of its shape and phone timelines, so
 * a held shape arrives as several cues differing only in `p`. Grouping them is
 * what lets the visibility rules stay rules about shapes.
 */
function shapeRuns(cues) {
  const runs = [];
  for (const c of cues) {
    const v = VISEME_SHAPES[c.v] ? c.v : SILENT;
    const clean = { t: c.t, v, i: c.i == null ? 1 : c.i, p: c.p ?? null };
    if (runs.length && runs[runs.length - 1][0].v === v) runs[runs.length - 1].push(clean);
    else runs.push([clean]);
  }
  return runs;
}

/**
 * Sort, merge consecutive duplicates, and drop sub-perceptual cues. Servers
 * emit noisy tracks; this makes them watchable.
 *
 * **Every decision here is a decision about shapes**, taken over the run heads
 * and nothing else. MIN_VISIBLE_CUE_MS and the closure swap are rules about what
 * the face can be *seen* to do, and a phone transition inside a held shape is
 * not something the face does at all — letting one participate would mean a
 * phone changing 15 ms before a real shape change could swallow that change,
 * which is a lipsync regression bought with a field this file does not read.
 * Phone detail is re-attached afterwards, bounded by the mouth positions either
 * side of it. Mirrors `normalize_cues` server-side.
 */
export function normalizeCues(cues) {
  const runs = shapeRuns([...cues].sort((a, b) => a.t - b.t));

  // Pass one: the shape track, by exactly the rule that predates phone detail.
  // `kept` maps each surviving cue back to the run it speaks for, which the
  // closure swap can change without moving the cue's timestamp.
  const out = [];
  const kept = [];
  for (let index = 0; index < runs.length; index++) {
    const head = runs[index][0];
    const v = head.v;
    const prev = out[out.length - 1];
    if (prev && prev.v === v) continue; // merge repeats
    if (prev && head.t - prev.t < MIN_VISIBLE_CUE_MS) {
      // Too short to read. Keep whichever is more visually salient: a closure
      // (A/G) carries more lip-reading information than a mid-open vowel.
      if (CLOSURES.has(v)) {
        // The short cue can sit between two identical closures (G → F → G).
        // Its replacement would otherwise create a duplicate visible shape;
        // preserving the first G is both the stable wire form and the face the
        // viewer actually saw.
        if (out.length > 1 && out[out.length - 2].v === v) { out.pop(); kept.pop(); }
        // A winning closure replaces the preceding shape for the entire
        // sub-perceptual interval. Preserve that cue's timestamp while taking
        // the closure's intensity, matching the server-side wire normalizer.
        else {
          out[out.length - 1] = { ...head, t: prev.t, v };
          kept[kept.length - 1] = index;
        }
      }
      continue;
    }
    out.push({ t: head.t, v, i: head.i, p: head.p });
    kept.push(index);
  }

  // Pass two: the phone detail inside each surviving mouth position. Silence is
  // never split — nothing is being articulated under a rest.
  const result = [];
  for (let slot = 0; slot < out.length; slot++) {
    const cue = out[slot];
    result.push(cue);
    if (cue.v === SILENT) continue;
    const limit = slot + 1 < out.length ? out[slot + 1].t : Infinity;
    for (const sub of runs[kept[slot]].slice(1)) {
      // Strictly after whatever was last emitted, not merely after the head: a
      // splice joins two legs' tracks and both can name the same millisecond.
      if (sub.t <= result[result.length - 1].t || sub.t >= limit) continue;
      if (sub.p === result[result.length - 1].p) continue;
      result.push({ t: sub.t, v: cue.v, i: sub.i, p: sub.p });
    }
  }
  return result;
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
    // Where the last sample() landed, for the layers that read the track's
    // future (prosody.js looks ahead to the end of a pause).
    this.now = 0;
  }

  get index() { return this._idx; }

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
    // A sentence can arrive after the one before it has played out — a TTS
    // whose next sentence lags its own audio does this routinely — and the
    // track had stopped at that sentence's tail. Resume on the same clock, or
    // the face holds still through audio the user can hear.
    if (!this.playing && this.clock && merged.length) {
      const last = merged[merged.length - 1];
      this.playing = last.v !== SILENT || this.clock() + LEAD_MS <= last.t + this.tailMs;
    }
  }

  stop() {
    this.playing = false;
    this.cues = [];
    this.clock = null;
    this._idx = 0;
  }

  /**
   * The shape to aim at now, which is not always the cue under the clock.
   *
   * Rounding starts before its sound, because it is the kind of gesture a
   * viewer reads a word by (speech-timing.js has the measurements): `round`
   * carries the pucker of a rounded vowel coming up within `ROUND_LEAD_MS`, for
   * the mixer to hold against the current shape's own. It does not reach
   * across a rest. A closure's early onset is not drawn here — the server
   * already starts every closure cue ahead of its phone, and a second lead on
   * top of that closed the lips a whole vowel early.
   *
   * @returns {{letter: string, intensity: number, phone: string | null, round: number} | null}
   */
  sample() {
    if (!this.playing || !this.cues.length || !this.clock) return null;
    const now = this.clock() + LEAD_MS;
    this.now = now;

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
    if (cue.t > now) return { letter: SILENT, intensity: 1, phone: null, round: 0 };
    let round = 0;
    for (let j = this._idx + 1; j < this.cues.length; j++) {
      const ahead = this.cues[j];
      if (ahead.v === SILENT || ahead.t - now > ROUND_LEAD_MS) break;
      // Across consonants too: protrusion before a rounded vowel grows with the
      // consonants in front of it (Noiray et al. 2011, JASA 129:340), so the
      // lips of "sm-" in "smooth" are already on their way.
      round = Math.max(round, VISEME_SHAPES[ahead.v].mouthRound);
    }
    return { letter: cue.v, intensity: cue.i == null ? 1 : cue.i, phone: cue.p ?? null, round };
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
