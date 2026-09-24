/**
 * Speech prosody: what a speaking face does *around* the mouth, read off the
 * same viseme track that drives the mouth, so it can never disagree with it.
 *
 * A talking head is mostly moved by its voice. Head motion alone accounts for
 * over 63 % of the variance in a speaker's F0 (Munhall et al. 2004), its
 * first canonical correlation with prosody runs about 0.7 (Busso et al.
 * 2007), and a face animated with the speaker's own natural head motion is
 * understood better than the same face held still — or moved at double
 * amplitude, which scored no better than none. That last result is the
 * sizing rule for everything here: natural, not more. Research, with the
 * numbers: docs/research-biomechanics.md §3.8.
 *
 * Each behaviour is here because a study found people use it:
 *
 *  - A blink at each pause. Speakers' blinks cluster at breakpoints of speech,
 *    and listeners entrain to exactly those blinks (Nakano & Kitazawa 2010;
 *    research-biomechanics.md §3.7, §5.4). A blink placed at a clause boundary
 *    is worth several on a timer, so the idle timer is re-armed each time.
 *  - A pose held through each phrase and changed between them. Most of a
 *    speaker's head motion is not the beats but a pose held and changed at
 *    phrase scale (Hadar et al. 1983's slow band). The change comes *before*
 *    the voice — the head moves first at over 70 % of phrase onsets (Graf et
 *    al. 2002) — so it is booked inside the pause, with the inbreath: speech
 *    breathing is a quick inbreath at the pause and a long outbreath over the
 *    phrase (§6.1).
 *  - Beats on the prominent vowels, about one a second where the speech has
 *    them. Brows up and a head stroke, the brows leading the accented syllable
 *    by ~60 ms (Flecha-García 2010). Graf's speaker nodded on most pitch
 *    accents and swung to a new position on a fifth of them, mostly in pitch,
 *    sometimes diagonally with yaw, and repeated her own motions — so the side
 *    a diagonal leans to is kept for the turn. The gate is the point: brow
 *    raises placed at random give no benefit (Al Moubayed & Beskow 2009), so a
 *    vowel that does not stand out gets no beat at all.
 *  - A settle on the last vowel of a phrase: the head comes down a little as
 *    a phrase closes (final lowering, §3.4) and *stays* down through the
 *    pause, until the next phrase lifts it.
 *  - Warmth at the edges of a turn. A smile held through a sentence is
 *    discounted as insincere (research-perception.md §3), so this is an
 *    episode: it rises as a turn starts and again as it ends, and is gone in
 *    between. The mixer withholds it under an emotion whose corners are down.
 *
 * **The head moves by holding, and that is the 2026-09-12 redesign.** Every
 * head behaviour above used to be a continuous envelope — a drift re-aimed each
 * phrase, strokes with counter-lobes, a lead-in dip — summed and low-passed,
 * which drew a head in motion from the first word to the last and read as
 * floating. It is now discrete: the held pose moves on a minimum-jerk path and
 * then is exactly still, and a beat is a pulse on top of it (head.js has the
 * argument). The amplitudes came down with it, to what a webcam shows of a
 * person talking — a few degrees — because they had been sized to the lab's
 * whole-sentence ranges, and on tara, a photograph on shallow geometry, a
 * turn that size is the moment she reads as a cutout.
 *
 * Prominence is estimated from what the cue stream carries. English stress is
 * mostly duration and loudness, and a cue has both: its length, and `i`, which
 * is TTS energy. That is a proxy for the pitch accent the studies measured, so
 * everything here is sized to be missed rather than to be wrong. The one
 * channel family it never writes is the mouth's articulation; lipsync is the
 * headline, and the corners it lifts are the ones visemes never touch.
 *
 * These are speech-rhythm movements, not acknowledgements. A beat is part of
 * how the avatar talks, like the torso moving more while it talks; a nod that
 * *means* yes is still only ever a server action.
 */

import { SILENT } from './visemes.js';
import { HeadPose } from './head.js';

// A silence this long is a pause, not the gap between two words. Word gaps in
// fluent TTS run ~50-200 ms; clause pauses start around a quarter second.
const PAUSE_MS = 250;
// Speakers blink ~20-26 times a minute. Clause pauses in fast speech can come
// closer than that, and a blink at every one reads as nervous.
const BLINK_MIN_GAP_MS = 1400;
// Only fire on a pause we arrive at, not one the track was joined midway into.
const BLINK_FRESH_MS = 150;

// The held pose, in pose units at gain 1. What a unit is worth in degrees is
// the rig's own scaling and is deliberately not repeated here: the figure that
// used to be, was wrong for the whole of the day the yaw envelope moved.
// Each phrase picks one, usually on the other side from the last,
// so consecutive phrases are a visible change of position rather than a
// wobble about the same one. Yaw is the narrowest in degrees because it is the
// axis a projected photograph survives least; pitch leans slightly chin-up,
// which is where a person talking to someone holds their head.
// **Every axis went up on 2026-09-21, and it is paying for something
// specific.** The speaking face used to get much of its movement from a gaze
// aversion — a look away that took the neck with it — and that is gone
// (gaze.js): the eyes now hold the user for the whole turn. Taking it out and
// changing nothing else left the speaking head measurably *stiller* than
// before, which is the defect the aversion had been introduced to fix. So the
// movement comes back as the pose the head holds per phrase, which is what a
// speaker's head actually does and is communicative rather than evasive.
//
// Sized against `presence.test.ts`, which renders a turn through the real
// mixer and prints the degrees. On tara the widest yaw here is ~4.9° and the
// widest chin-up ~4.4°, inside the 6° and 5° she was measured at for a *held*
// pose; what the same table showed before the raise was a speaking head
// reaching 4.2° of yaw and 2.1° of pitch, the second of which is under half of
// what the aversion had been supplying. `headHold` softens the sum in any
// case, so a character measured tighter than tara gets her own angle here for
// free.
const POSE = {
  headYaw: [0.15, 0.44],
  // **Pitch widens downward only, and the chin-up end is pinned where it was.**
  // Opening it to -0.26 with the rest measured as a speaking face reading
  // *sleepy*: the lids follow the globe, and on a rig with a reflex a chin-up
  // head means eyes rolled down to hold the user, which narrows the aperture
  // for real. The audit's open-lid median went 0.149 -> 0.163 against a 0.15
  // ceiling (research-perception.md § 6) on that change alone. So the chin-up
  // end stays at the -0.20 it was measured safe at, and the extra travel comes
  // off the other end, where the reflex rolls the eyes *up* and the lid opens.
  // A phrase pose returns, so this is not the chin-drift that reads downcast.
  headPitch: [-0.20, 0.22],
  headRoll: [0.12, 0.34],
  // The mouth corners take a small share of each pose: a speaking mouth whose
  // corners never move reads as dubbed. They ease rather than move, since a
  // corner that jumps reads as a twitch.
  corner: [0, 0.09],
  cornerTauS: 0.9,
  // **The brows take a level per phrase too, and it is signed.** Measured over
  // the audit's 56 s turn, `browRaiseL` sat at exactly 0.000 for 84% of frames
  // and never once went negative: between beats the upper face was pinned at
  // the floor of its range. Two video reviewers named that stillness — "the
  // eyebrows, forehead, and the muscles around the eyes do not move" — as the
  // single biggest reason these faces read as uncanny, ahead of the mouth. The
  // corners above already had a held level and measured 0.1%, so the brows
  // were the channel with no *pose*, not the channel with no events.
  //
  // Signed is the half that carries it. `browRaise` is the one channel the
  // Blender rigs split by sign into two photographed maps — a raise above zero
  // and a knit below it — so a phrase sitting negative is the only route a
  // real furrow has into a sentence. Pinned at zero, half the asset was
  // unreachable by construction. The floor is `thoughtful`'s own -0.14, which
  // character-rig's knit weight already cites as a third of the crease; the ceiling
  // stays well under a beat's 0.34 so a held level is never read as an accent.
  brow: [-0.14, 0.18],
  browTauS: 0.8,
  // One brow leads, the way BEAT.browAmp's 0.34/0.30 already has it: a matched
  // pair is the drawing, not the face.
  browAsym: 0.82,
  switchP: 0.7,
  // A phrase with no pause long enough to book a move keeps its pose, unless
  // the pose is this old: then the phrase takes a new one as it starts.
  holdMs: 3200,
};

// The move into a new phrase's pose. It starts inside the pause and lands
// around the first syllable, and only a pause this long books one — a shorter
// one is a breath between clauses, not a new thought.
const ONSET = { minPauseMs: 400, leadMs: 280, durMs: 380 };
// The inbreath: fast in across the pause's end, then let out over the phrase.
// The idle layer's quiet breathing steps back while speech runs (idle.js), so
// this is the breath a talking body shows rather than one on top of it.
const INHALE = [[-420, 0], [-140, 1], [700, 0.55], [2200, 0]];
const INHALE_AMP = 0.7;

const BEAT = {
  // The open vowels carry the energy, and the jaw drop that a stressed vowel
  // gets; the closures and the narrow shapes are never the peak.
  vowels: new Set(['C', 'D', 'E']),
  // Measured over a 42 s track of real cue data, a stricter gate made one beat
  // per 4.2 s of voiced speech, where accents come about once a second; the
  // median phrase on that track is 1.26 s, so a long floor disqualified a
  // third of the phrases outright.
  minPhraseMs: 600,
  minVowels: 2,
  minDurMs: 100,
  // How far above the phrase's mean a vowel must stand to count as prominent,
  // and it must also be the strongest within `localMs` either side of it. A
  // phrase of equal vowels still gets nothing.
  salience: 1.05,
  localMs: 380,
  // Beats at least this far apart; closer and they read as a metronome, and
  // their stroke frequency climbs past the 1.5 Hz line (CLAUDE.md).
  gapMs: 620,
  // Each vowel is weighed once, as it enters this window ahead of the clock:
  // late enough that the cues around it have arrived, early enough for the
  // head stroke's run-up.
  commitMs: 340,
  windowMs: 180,
  // Relative to the vowel onset. The brows hold ~150 ms and come down over
  // ~300 ms, the slower release of a real frontalis, and the upper lids lift
  // a little with them — a brow flash that leaves the lids is a frown's half.
  brow: [[-140, 0], [-40, 1], [110, 1], [410, 0]],
  browAmp: [0.34, 0.30],
  lidAmp: -0.05,
  // **How big a beat is, the syllable decides.** Over a 20.7 s turn of real
  // cue data every beat was authored at exactly 0.340 — 55 of them across five
  // seeds, sd 0.000 — while the loudness of the vowels that won them ran 0.51
  // to 1.00. A vowel can win on length alone, since `score` is duration times
  // loudness, so a quiet long syllable drew the same flash as a shouted one. A
  // face whose every accent is the same size is the "repetitive, like a
  // puppet" read the mouth already had before `shapeFor` scaled it by this
  // same `i`; nothing scaled these.
  //
  // It varies *upward*, because the complaint underneath this one is a still
  // upper face: no beat may shrink. The quiet end lands at 0.349, above the
  // 0.340 every beat used to take, and the range runs to 0.408. That is also
  // what keeps the line faces safe — `browPath` lifts a brow 15 units of an
  // 800-unit frame, so a beat is only ~0.8 px at the 130 px acceptance size,
  // and the mouth's own `0.45 + 0.55i` would have halved it into nothing. The
  // ceiling is the asset's: tara's raise map reads `browRaise / 0.6` and
  // clamps, so under `POSE.brow`'s 0.18 held level a gain past ~1.24 buys
  // light that is already saturated.
  browGain: [0.85, 0.35],
  // **A brow has more than one shape.** Measured over a speaking turn,
  // `browAngleL` and `browInnerL` once moved exactly 0.000: every beat drew the
  // same symmetric raise. The plain raise stays the common one; the inner lift
  // is AU1, the appeal, and deliberately the rarest, because a face that keeps
  // lifting its inner brows reads as worried; the outer-end tilt exists so two
  // beats in a row are not the same drawing. Shapes of one event, on one
  // envelope.
  browForms: [
    { p: 0.60, inner: 0.00, angle: 0.00 },
    { p: 0.25, inner: 0.26, angle: 0.00 },
    { p: 0.15, inner: 0.00, angle: 0.30 },
  ],
  // What the head does with a beat. A swing is Graf's one-way movement — the
  // beat taken as a move to a new pose — and is only offered once the pose has
  // been held a while, so a phrase does not change position twice in a breath.
  // Of the rest most are a nod and some leave the head alone: a beat on every
  // accent is a metronome, and the brows still carry it.
  //
  // **Raised on 2026-09-21, and this is where the speaking head's motion went.**
  // Deleting the speaking aversion (gaze.js) took its head share with it, and
  // that share had been most of what moved the head *inside* a sentence: the
  // per-sentence deviation fell from 0.79 deg of yaw to 0.55 measured on the
  // audit's real cue track, because a held phrase pose contributes nothing to a
  // deviation taken about that phrase's own mean. The swing is the honest way
  // to put it back — it is a move to a new pose rather than a look away from
  // the user, which is the whole distinction the removal was about, and Graf
  // has the speaker doing it. Offered more often and after a shorter hold; the
  // hold is still long enough that a phrase does not reposition twice in a
  // breath.
  swingP: 0.42,
  swingAfterMs: 1400,
  swingMs: 320,
  nodP: 0.7,
  // The nod: down and back, over by 0.4 s, and nothing after it. It peaks just
  // ahead of the vowel so that, through the head's 160 ms smoothing, it lands on
  // it. About 2.5° asked of tara, of which the smoothing renders most.
  nod: { pitch: 0.15, attack: 130, release: 240, lead: 170 },
  // A diagonal nod's yaw, on the turn's side. Raised with the swing above, and
  // for the same reason — a diagonal beat moves the head across the sentence
  // where a pure pitch nod only moves it down and back. The amplitude is
  // untouched: the nod's read defect was its geometry, never its size.
  yawP: 0.45,
  yaw: 0.12,
};

// **The body's share of a beat.** A speaker's trunk is not decorative on an
// accent: emphasis travels down, the shoulders lift and set slightly on a
// stressed syllable, and a phrase boundary is where posture resets (Hadar et
// al. 1983 tied the pattern of movement against stillness to juncture). It is
// not a gesture — there is no arm — but the head's stroke arriving late and
// small at the shoulders, which `params.TAU` supplies for free by chasing the
// shoulders at 0.19 s and the lean at 0.24 s. Each stroke returns through
// neutral: a trunk that only ever lifts is a standing shrug, which is what a
// filmstrip once showed as the figure sitting larger and lower in frame.
// Raised on 2026-09-21 with the rest of the body: the trunk has no measured
// hold budget the way the head does — nothing about a shoulder tells a
// projected photograph it has been turned too far — so it is the channel where
// "a bit more movement" is free, and it is the one the head-on-a-stick read
// comes from.
const BEAT_BODY = {
  keys: [[-380, 0], [-60, 1], [140, 0.25], [320, -0.30], [600, 0]],
  shoulder: 0.36, lean: 0.15, spread: 0.35,
};
// The lift a phrase carries, over its own span: up on the first stressed
// syllable and settling below where it started as the breath goes out.
const PHRASE_BODY = {
  keys: [[-260, 0], [180, 1], [900, 0.5], [1500, -0.30], [2400, 0]],
  shoulder: 0.28,
  lean: 0.21,
};

// The phrase-final settle: chin down this far from the phrase's own pose,
// held until the next phrase lifts it. Pitch only, and slower than a nod — it
// closes a phrase rather than marking a word.
const SETTLE = { pitch: 0.07, lead: 60, durMs: 360, gapMs: 520 };

// A turn that ends, or a clip that takes the head, sends it home this fast.
const HOME_MS = 700;

// Warmth: corners, and the squint that makes them a smile rather than a mask
// (emotions.js). A smile that never varies is discounted as insincere
// (research-perception.md §3), so warmth only ever comes as an episode, with
// an onset, a hold and an offset, and each is tied to something that
// happened: the reply's first words (`onset`, from the first voiced cue), the
// reply played out to its end (`close`), and an acknowledgement the server
// sent (`ack`). Felt smiles run from about two-thirds of a second to four
// (Ekman & Friesen 1982), and a listener's smile is itself a backchannel
// (Brunner 1979).
//
// `close` is the face the user sees as the floor passes to them, so it is the
// biggest and the longest: full for 2.6 s, gone by 3.8 s, seen while they
// start to talk and gone before it could read as fixed. It used to be 0.18
// held 1.2 s, which on the Blender faces barely lifted the corners before it
// went; judged at crop on tara and tushar, 0.36 is the first height that
// reads as a smile rather than a resting mouth, and still well under the
// happy states' 0.48–0.58. `onset` stays small, because the visemes are about
// to take the mouth.
// `ack` rises with the nod and outlasts it, since a smile that ends with the
// head's last beat reads as part of the gesture rather than as pleasure.
//
// `listen` is the fourth, and it is the one episode that is not about speech at
// all: the floor has arrived and the face receives it. Every other state change
// the avatar makes is a change of task; this one is a change of *who is
// talking*, and a face that takes the floor back with no expression at all is
// where the "not smiling enough" read comes from. Its shape is the owner's
// (2026-09-21): up, then a long fade to neutral rather than a held level, which
// is the same argument the other three are built on — a smile that stays is
// discounted. The full height lasts 1.8 s, inside Ekman's felt-smile window,
// and the remaining 3.8 s is the fade. **It is the warmest of the four, raised
// on the owner's read of 2026-09-21 that it was not arriving.** It started at
// `ack`'s height and reasoned that `close` — the face that hands the floor
// over — should outrank the face that takes it; on screen that had it landing
// as a politeness rather than as a welcome, and this is the one episode a user
// is looking straight at when it fires.
// Times in ms.
const WARMTH = {
  onset: { keys: [[0, 0], [350, 1], [1500, 1], [2800, 0]], corner: 0.18, squint: 0.08 },
  close: { keys: [[0, 0], [300, 1], [2600, 1], [3800, 0]], corner: 0.36, squint: 0.14 },
  ack: { keys: [[0, 0], [220, 1], [1100, 1], [2000, 0]], corner: 0.30, squint: 0.12 },
  listen: { keys: [[0, 0], [400, 1], [2200, 1], [6000, 0]], corner: 0.42, squint: 0.17 },
};
// A continuer can come every second or two. Each one smiling would hold the
// smile up for as long as the user talks, which is the fixed smile again, so
// an acknowledgement inside this long of the last smiling one nods without it.
const ACK_SMILE_REST_MS = 4000;
// The listening smile rests behind *any* warmth, not just its own, and this is
// the whole of what keeps it from becoming the fixed smile. A turn normally
// ends SPEAKING -> `close` -> LISTENING within a few hundred ms, and `close` is
// already that handover's smile; a state that flaps back through LISTENING —
// through THINKING and out again, or a barge-in and a resume — would otherwise
// re-arm one every time. Longer than the episodes themselves, so two can never
// run end to end.
const LISTEN_SMILE_REST_MS = 7000;

/**
 * What a rig renders of the head amplitudes above, unless it says otherwise.
 *
 * **A pose unit is not a shared quantity.** On tara it is an angle; on an SVG
 * face it is a pixel count — `peep`'s head travels about 17 px per unit of
 * pitch on a 130 px drawing. A rig passes its own `prosodyHeadGain` (tara: 1);
 * one that has not been measured renders this share. It was held at 0.3 while
 * the amplitudes here were sized to the lab's ranges, which scaled peep's
 * speaking head to 20 px; sized to the medium they are small enough to render
 * whole, and the SVG faces now take the same hold-and-move head as tara —
 * unjudged by eye on them, which is the open item this number stands for.
 */
export const UNCALIBRATED_HEAD_GAIN = 1;

function envelope(t, keys) {
  if (t <= keys[0][0] || t >= keys[keys.length - 1][0]) return 0;
  for (let k = 1; k < keys.length; k++) {
    const [t1, v1] = keys[k];
    if (t <= t1) {
      const [t0, v0] = keys[k - 1];
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
  }
  return 0;
}

const endOf = (keys) => keys[keys.length - 1][0];
const rand = ([a, b]) => a + Math.random() * (b - a);
const side = () => (Math.random() < 0.5 ? -1 : 1);

const isPause = (cues, j) =>
  cues[j].v === SILENT && (j + 1 >= cues.length || cues[j + 1].t - cues[j].t >= PAUSE_MS);

/** Channels this layer writes, besides the `blink` flag. */
export const PROSODY_CHANNELS = [
  'headPitch', 'headYaw', 'headRoll',
  'browRaiseL', 'browRaiseR', 'browInnerL', 'browInnerR',
  'browAngleL', 'browAngleR', 'lidL', 'lidR',
  'mouthCornerL', 'mouthCornerR', 'squintL', 'squintR',
  'breath',
  'shoulderL', 'shoulderR', 'torsoLean',
];

export class SpeechProsody {
  constructor(opts = {}) {
    // Moves are timed on this layer's own clock, not the track's: a turn's
    // clock restarts, and the tails of a settle or a closing smile outlive the
    // track they came from.
    this._ms = 0;
    this._moves = [];
    this._warm = [];
    this._lastAckSmile = -Infinity;
    this._lastWarm = -Infinity;
    this._head = new HeadPose();
    this._home = true;
    this._corner = 0;
    this._cornerTo = 0;
    this._brow = 0;
    this._browTo = 0;
    // See `_drawBrow`. Defaulted to the range every face has always drawn from
    // with no band skipped, so a seeded reel of an SVG or Canvas face draws the
    // same level from the same `Math.random` call as before.
    this._brows = { range: POSE.brow, floor: 0, forms: BEAT.browForms, ...opts.brows };
    this._side = side();
    this.reset();
  }

  /**
   * Forget the utterance: its times are offsets into a clock that restarts.
   * `newTurn` false is the same turn re-spoken on the same clock (the accurate
   * leg splicing), and everything already weighed stays weighed.
   */
  reset(newTurn = true) {
    if (!newTurn) return;
    this._blinkKey = null;
    this._lastBlink = -Infinity;
    this._resumeKey = null;
    this._bookedKey = null;
    this._scanT = -Infinity;
    this._lastBeat = -Infinity;
    this._lastMove = -Infinity;
    this._phraseKey = null;
    this._poseAt = -Infinity;
    this._phrasePitch = 0;
    this._onsetPending = true;
    // The side a diagonal beat leans to, and which way roll couples to yaw,
    // are the speaker's habit for the turn (Graf: motions repeat).
    this._beatSide = side();
    this._rollSide = side();
  }

  /** The track played out to its end: the turn's closing warmth. */
  closeTurn() {
    this._smile(WARMTH.close);
  }

  /**
   * The avatar has entered LISTENING: the floor is the user's. A warmth
   * episode, unless something smiled recently — see `LISTEN_SMILE_REST_MS`,
   * which is what stands between this and a face that is always smiling.
   *
   * Nothing smiles when the user *starts* talking, on purpose. The client has
   * no event for that moment, and a smile the renderer timed for itself would
   * be an acknowledgement nobody sent. The lever for more warmth while
   * listening is the server sending more `ACK_NOD`s, never a timer here.
   */
  listen() {
    if (this._ms - this._lastWarm < LISTEN_SMILE_REST_MS) return;
    this._smile(WARMTH.listen);
  }

  /** Start a warmth episode, and remember that the face has just smiled. */
  _smile(w) {
    this._lastWarm = this._ms;
    this._warm.push({ at: this._ms, w });
  }

  /**
   * The server acknowledged what the user is saying: the smile that goes with
   * it. Here rather than in the clip because it has to outlast the nod, and
   * because it is one smile with the turn-edge warmth when the two meet.
   */
  acknowledge() {
    if (this._ms - this._lastAckSmile < ACK_SMILE_REST_MS) return;
    this._lastAckSmile = this._ms;
    this._smile(WARMTH.ack);
  }

  /** Cut off: a smile that survives being interrupted has not noticed. The
   *  rest period is deliberately *not* cleared — being interrupted is not an
   *  occasion to smile a fresh one at the state change that follows. */
  cool() {
    this._warm = [];
  }

  /**
   * @param {{cues: {t:number, v:string, i?:number}[], now: number, index: number}} track
   *        the viseme track, already sampled this frame
   * @param {boolean} active speech owns the mouth and no clip is gesturing
   * @param {number} [dt] seconds since the last frame
   * @returns {Record<string, number> & {blink: boolean}} additive deltas on
   *          PROSODY_CHANNELS, at gain 1
   */
  update(track, active, dt = 1 / 60) {
    this._ms += dt * 1000;
    const out = { blink: false };
    for (const c of PROSODY_CHANNELS) out[c] = 0;

    if (active && track.cues.length) {
      this._home = false;
      this._listen(track, out);
    } else {
      // Beats belong to the words: an interrupted or gesture-covered turn
      // drops the ones still to come, and the head goes home. Tails play out.
      this._moves = this._moves.filter((m) => m.keep);
      this._cornerTo = 0;
      this._browTo = 0;
      if (!this._home) {
        this._home = true;
        this._head.cancelStrokes(this._ms);
        this._head.moveTo({ headYaw: 0, headPitch: 0, headRoll: 0 }, this._ms, HOME_MS);
      }
    }

    const t = this._ms;
    const h = this._head.sample(t);
    out.headYaw += h.headYaw;
    out.headPitch += h.headPitch;
    out.headRoll += h.headRoll;
    // Where the head is turned, without the strokes on it. The trunk follows
    // it — a phrase's pose recruits the body, a nod does not — and the mixer
    // budgets against it, for the same division: what the head *holds* is what
    // has to stay inside a face's measured range, and a stroke is forgiven a
    // peak because it is over before it is read as a pose.
    out.hold = this._head.held(t);
    out.trunkYaw = out.hold.headYaw;
    this._corner += (this._cornerTo - this._corner) * (1 - Math.exp(-dt / POSE.cornerTauS));
    out.mouthCornerL += this._corner;
    out.mouthCornerR += this._corner;
    // Eased rather than moved: a brow that steps to its phrase's level reads as
    // a beat, and the beats are already on top of this.
    this._brow += (this._browTo - this._brow) * (1 - Math.exp(-dt / POSE.browTauS));
    out.browRaiseL += this._brow;
    out.browRaiseR += this._brow * POSE.browAsym;

    this._moves = this._moves.filter((m) => t - m.at < endOf(m.keys));
    for (const m of this._moves) {
      const e = envelope(t - m.at, m.keys);
      if (e) for (const c in m.add) out[c] += e * m.add[c];
    }
    // Two warmth episodes that meet are one smile, not a bigger one.
    this._warm = this._warm.filter((m) => t - m.at < endOf(m.w.keys));
    let corner = 0;
    let squint = 0;
    for (const m of this._warm) {
      const e = envelope(t - m.at, m.w.keys);
      corner = Math.max(corner, e * m.w.corner);
      squint = Math.max(squint, e * m.w.squint);
    }
    out.mouthCornerL += corner;
    out.mouthCornerR += corner;
    out.squintL += squint;
    out.squintR += squint;
    return out;
  }

  _listen(track, out) {
    const { cues, now } = track;
    const i = Math.min(track.index, cues.length - 1);
    const cue = cues[i];
    if (cue.t > now) return;
    // Converts a time on the track's clock to one on this layer's.
    const at = (ms) => this._ms + (ms - now);

    // The pause blink.
    if (isPause(cues, i) && cue.t !== this._blinkKey) {
      this._blinkKey = cue.t;
      if (now - cue.t < BLINK_FRESH_MS && now - this._lastBlink >= BLINK_MIN_GAP_MS) {
        this._lastBlink = now;
        out.blink = true;
      }
    }

    // The next phrase's pose and the inbreath: booked inside a long pause,
    // played through the resume.
    if (cue.v === SILENT && i + 1 < cues.length && cue.t !== this._resumeKey
        && cues[i + 1].t - cue.t >= ONSET.minPauseMs) {
      this._resumeKey = cue.t;
      this._bookedKey = cues[i + 1].t;
      this._pose(at(cues[i + 1].t) - ONSET.leadMs, ONSET.durMs);
      this._moves.push({ at: at(cues[i + 1].t), keys: INHALE, add: { breath: INHALE_AMP } });
    }

    if (cue.v !== SILENT) {
      if (this._onsetPending) {
        this._onsetPending = false;
        this._smile(WARMTH.onset);
      }
      let a = i;
      while (a > 0 && !isPause(cues, a - 1)) a--;
      if (cues[a].t !== this._phraseKey) {
        this._phraseKey = cues[a].t;
        // A phrase nothing was booked for: the turn's first words, or a
        // phrase after a pause too short to book a move in. An old pose
        // changes as it starts; a recent one just lifts out of its settle.
        if (this._bookedKey !== cues[a].t) {
          if (this._ms - this._poseAt >= POSE.holdMs) this._pose(this._ms, ONSET.durMs);
          else this._head.moveTo({ headPitch: this._phrasePitch }, this._ms, ONSET.durMs);
        }
        // The postural lift belongs to the sentence.
        this._moves.push({
          at: at(cues[a].t), keys: PHRASE_BODY.keys,
          add: {
            shoulderL: PHRASE_BODY.shoulder, shoulderR: PHRASE_BODY.shoulder,
            torsoLean: PHRASE_BODY.lean,
          },
        });
      }
    }

    // Every vowel is weighed once, as it comes into the commit window. One
    // that arrives already inside it is let go: a late stroke is worse than
    // none.
    for (let j = i; j + 1 < cues.length && cues[j].t - now <= BEAT.commitMs + BEAT.windowMs; j++) {
      const c = cues[j];
      if (c.t <= this._scanT || !BEAT.vowels.has(c.v)) continue;
      this._scanT = c.t;
      if (c.t - now >= BEAT.commitMs) this._weigh(cues, j, at);
    }
  }

  // A new pose for the head, starting at `at` on this layer's clock. The next
  // phrase usually turns the other way.
  _pose(at, dur) {
    this._poseAt = at;
    if (Math.random() < POSE.switchP) this._side = -this._side;
    const s = this._side;
    this._phrasePitch = rand(POSE.headPitch);
    this._head.moveTo({
      headYaw: s * rand(POSE.headYaw),
      headPitch: this._phrasePitch,
      headRoll: s * this._rollSide * rand(POSE.headRoll),
    }, at, dur);
    this._cornerTo = rand(POSE.corner);
    this._browTo = this._drawBrow();
  }

  /**
   * The level this phrase holds its brows at.
   *
   * `floor` is a band about zero the draw skips. `browRaise` is the one channel
   * the Blender rigs split by sign into two photographed maps — a raise above
   * zero, a knit below it — and *both* read as nothing near zero, so a range
   * straddling it spends most of its phrases in a dead band where the upper
   * face recruits no light at all. That is the deadpan: not too few events, but
   * a pose that is usually nowhere. Skipping the band makes each phrase commit
   * to a furrow or a lift.
   *
   * It is a floor and not a bigger range on purpose. What the prohibitions here
   * turn on is *hold*, not size — a held inner lift reads as worried, a held
   * outer kink as a smirk — and this changes only how far the brows travel
   * between one phrase and the next, never how long any shape is kept.
   *
   * The two sides keep their widths' share of the draw rather than collapsing
   * onto ±floor: a skipped band must not become a pair of repeated values.
   */
  _drawBrow() {
    const [a, b] = this._brows.range;
    const f = this._brows.floor;
    const lo = Math.max(0, -f - a);
    const hi = Math.max(0, b - f);
    if (!(f > 0) || lo + hi <= 0) return rand(this._brows.range);
    return Math.random() * (lo + hi) < lo ? rand([a, -f]) : rand([f, b]);
  }

  // Decides whether vowel `j` carries a beat or closes its phrase.
  _weigh(cues, j, at) {
    let a = j;
    while (a > 0 && !isPause(cues, a - 1)) a--;
    let b = j;
    while (b + 1 < cues.length && !isPause(cues, b)) b++;
    const complete = isPause(cues, b);
    const span = cues[b].t - cues[a].t;
    const vowels = [];
    for (let k = a; k < b; k++) {
      const c = cues[k];
      if (!BEAT.vowels.has(c.v)) continue;
      const dur = cues[k + 1].t - c.t;
      // `score` ranks, `i` sizes. They are kept apart deliberately: a missing
      // loudness still scores as a full one so selection is unchanged, but it
      // leaves `i` null so the beat below stays exactly as it was authored.
      vowels.push({ t: c.t, dur, i: c.i, score: dur * (c.i == null ? 1 : c.i) });
    }
    const v = vowels.find((x) => x.t === cues[j].t);

    // The last vowel before a pause is long because the phrase is ending, not
    // because it is stressed: final lengthening marks a boundary, and scoring
    // it would put a beat on the last word of nearly every phrase. It gets the
    // settle instead.
    if (complete && v === vowels[vowels.length - 1]) {
      if (span >= BEAT.minPhraseMs && v.t - this._lastMove >= SETTLE.gapMs) {
        this._lastMove = v.t;
        this._head.moveTo({ headPitch: this._phrasePitch + SETTLE.pitch }, at(v.t) - SETTLE.lead, SETTLE.durMs);
      }
      return;
    }
    if (complete) vowels.pop();

    if (span < BEAT.minPhraseMs || vowels.length < BEAT.minVowels) return;
    const mean = vowels.reduce((s, x) => s + x.score, 0) / vowels.length;
    if (v.dur < BEAT.minDurMs || v.score < BEAT.salience * mean) return;
    if (vowels.some((x) => x !== v && Math.abs(x.t - v.t) < BEAT.localMs && x.score > v.score)) return;
    if (v.t - this._lastBeat < BEAT.gapMs) return;
    this._lastBeat = this._lastMove = v.t;

    let yaw = 0;
    const vt = at(v.t);
    if (vt - this._poseAt >= BEAT.swingAfterMs && Math.random() < BEAT.swingP) {
      this._pose(vt - BEAT.nod.lead, BEAT.swingMs);
      yaw = this._head.aim.headYaw;
    } else if (Math.random() < BEAT.nodP) {
      const add = { headPitch: BEAT.nod.pitch };
      if (Math.random() < BEAT.yawP) add.headYaw = yaw = this._beatSide * BEAT.yaw;
      this._head.stroke(add, vt - BEAT.nod.lead, BEAT.nod.attack, BEAT.nod.release);
    }

    const forms = this._brows.forms;
    let br = Math.random() * forms.reduce((s, f) => s + f.p, 0);
    const bf = forms.find((f) => (br -= f.p) < 0) || forms[0];
    // The whole gesture takes the syllable's size, not the raise alone: the
    // form's parts keep their proportions to each other, so a loud beat is the
    // same drawing bigger rather than a different shape.
    const g = v.i == null ? 1 : BEAT.browGain[0] + BEAT.browGain[1] * v.i;
    this._moves.push({
      at: vt, keys: BEAT.brow,
      add: {
        browRaiseL: BEAT.browAmp[0] * g, browRaiseR: BEAT.browAmp[1] * g,
        browInnerL: bf.inner * g, browInnerR: bf.inner * g,
        // The tilt is the one asymmetric thing here: both outer ends go up on
        // the side the beat already leans to, which is a shade rather than the
        // matched pair a symmetric lift would draw.
        browAngleL: bf.angle * g * (this._beatSide < 0 ? 1 : 0.55),
        browAngleR: bf.angle * g * (this._beatSide > 0 ? 1 : 0.55),
        lidL: BEAT.lidAmp * g, lidR: BEAT.lidAmp * g,
      },
    });
    // The trunk takes the same stroke. The two shoulders are deliberately
    // unequal — `spread` puts more of it on the side the head is going, so a
    // diagonal beat reads as one body turning rather than two shoulders
    // shrugging in unison, which is the tell of a rig with no spine.
    const lead = yaw < 0 ? -1 : 1;
    this._moves.push({
      at: vt, keys: BEAT_BODY.keys,
      add: {
        shoulderL: BEAT_BODY.shoulder * (1 + lead * BEAT_BODY.spread),
        shoulderR: BEAT_BODY.shoulder * (1 - lead * BEAT_BODY.spread),
        torsoLean: BEAT_BODY.lean,
      },
    });
  }
}
