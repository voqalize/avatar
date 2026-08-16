/**
 * The rig parameter space.
 *
 * Everything the face can do is a point in this ~30-dimensional space. Visemes,
 * emotions, gaze poses and gesture keyframes are all just named vectors here, so
 * blending them is plain arithmetic rather than SVG path surgery.
 *
 * Sign conventions (viewer's perspective):
 *   headYaw   +  turns toward viewer's right
 *   headPitch +  chin down
 *   headRoll  +  tilts toward viewer's right
 *   pupilX    +  right,  pupilY + down
 *   browRaise +  up,  browAngle + outer end up,  browInner + inner end up
 *   mouthCornerL/R + up (smile)
 */

export const REST = {
  // --- mouth -------------------------------------------------------------
  mouthOpen: 0.02, // vertical aperture, 0..1
  mouthWidth: 0.42, // 0 narrow .. 1 wide (0.42 is neutral)
  mouthRound: 0.1, // pucker / lip protrusion
  mouthPress: 0.15, // lips thinned & pressed together
  mouthTuck: 0.0, // lower lip drawn under upper teeth (F/V)
  // Availability is not a permanent smile. Warmth and encouragement are
  // explicit behavioral choices layered above this neutral resting shape.
  mouthCornerL: 0.0, // -1 frown .. +1 smile
  mouthCornerR: 0.0,
  teethUpper: 0.0, // how far the upper teeth show, 0..1
  tongue: 0.0, // tongue raised into the aperture, 0..1
  jaw: 0.0, // extra chin drop, follows mouthOpen but slower

  // --- eyes --------------------------------------------------------------
  // A fully-open lid shows an unnatural ring of sclera; real neutral eyes sit
  // with the upper lid already grazing the iris.
  lidL: 0.12, // 0 wide open .. 1 fully closed
  lidR: 0.12,
  squintL: 0.0, // lower lid raised (smile / suspicion)
  squintR: 0.0,
  pupilX: 0.0,
  pupilY: 0.05,

  // --- brows -------------------------------------------------------------
  browRaiseL: 0.0,
  browRaiseR: 0.0,
  browAngleL: 0.0,
  browAngleR: 0.0,
  browInnerL: 0.0, // inner-end lift, the "concern" muscle (AU1)
  browInnerR: 0.0,

  // --- head & body -------------------------------------------------------
  headYaw: 0.0,
  headPitch: 0.0,
  headRoll: 0.0,
  breath: 0.0, // driven by the idle layer, 0..1 through the cycle

  // --- shoulders & torso -------------------------------------------------
  // Shoulders are a floor-management channel as much as an affective one. The
  // single most legible "I would like to come in" signal a person gives is the
  // shoulders rising with an inbreath, and the face alone cannot say it.
  shoulderL: 0.0, // -1 dropped .. +1 raised
  shoulderR: 0.0,
  // Leaning in is engagement and leaning back is withdrawal, and in a webcam
  // frame both are read almost entirely as a change of scale.
  torsoLean: 0.0, // -1 back .. +1 forward
  // The trunk's own lateral axis, and the last body degree of freedom the rig
  // was missing. Before it, everything below the collar could do was rise,
  // fall and scale: a motion map over a 24-second listening run showed the
  // outer edge of the body travelling exactly zero pixels. A seated person's
  // trunk shifts sideways constantly — settling, re-settling, and lagging
  // after a head turn — and none of that was expressible.
  //
  // It carries the head's turn on a much slower time constant (below), which
  // is what buys follow-through for free: the mixer retargets it to headYaw
  // every frame and the difference in TAU does the rest.
  torsoTurn: 0.0, // -1 trunk toward viewer's left .. +1 right
};

// There are deliberately no arm or hand channels. The rig carried a full
// forearm/hand chain — raise, spread, wrist rotation, splay, thumb, index — and
// it was removed rather than fixed. Two reasons, both worth knowing before
// anyone re-adds it. The framing is a head-and-shoulders portrait, so a hand
// only exists at the bottom edge of the crop and every pose is a compromise
// between "large enough to read" and "not covering the face"; and gesture is a
// fraction of a percent of what this widget is for, against which the arm chain
// was the single largest and most defect-prone body of geometry in the rig.
// What the arms used to say — assent, deference, wanting the floor, apology —
// is said by the head, brows, shoulders and torso lean instead, which is where
// a viewer looking at a face on a video call is already looking.

export const CHANNELS = Object.keys(REST);

/**
 * Channel groups. Gesture clips declare which groups they own so that, say, a
 * nod during speech moves the head without stealing the mouth from the viseme
 * stream.
 */
export const GROUPS = {
  mouth: [
    'mouthOpen', 'mouthWidth', 'mouthRound', 'mouthPress', 'mouthTuck',
    'teethUpper', 'tongue', 'jaw',
  ],
  smile: ['mouthCornerL', 'mouthCornerR'],
  eyes: ['lidL', 'lidR', 'squintL', 'squintR'],
  gaze: ['pupilX', 'pupilY'],
  brows: [
    'browRaiseL', 'browRaiseR', 'browAngleL', 'browAngleR',
    'browInnerL', 'browInnerR',
  ],
  head: ['headYaw', 'headPitch', 'headRoll'],
  body: ['breath', 'torsoLean', 'torsoTurn'],
  shoulders: ['shoulderL', 'shoulderR'],
};

/**
 * Per-channel smoothing time constants, in seconds. This is where the face gets
 * its sense of mass: the mouth snaps, the head drifts. It also does all the
 * viseme co-articulation for free — we never blend shapes explicitly, we just
 * retarget and let the mouth channels chase at ~40ms.
 */
export const TAU = (() => {
  const t = {};
  for (const c of CHANNELS) t[c] = 0.09;
  for (const c of GROUPS.mouth) t[c] = 0.042;
  for (const c of GROUPS.smile) t[c] = 0.13;
  t.lidL = t.lidR = 0.018; // blinks must be crisp
  t.squintL = t.squintR = 0.12;
  t.pupilX = t.pupilY = 0.032; // saccades are ballistic and fast
  for (const c of GROUPS.brows) t[c] = 0.08;
  for (const c of GROUPS.head) t[c] = 0.16; // the head has real mass
  t.breath = 0.25;
  t.jaw = 0.07; // the jaw lags the lips slightly
  // The torso has more mass than the head and reads wrong when it hasn't.
  t.shoulderL = t.shoulderR = 0.19;
  t.torsoLean = 0.24;
  // Nearly 3x the head's, and that ratio is the whole point rather than a
  // taste call. The mixer feeds torsoTurn the *same* target as headYaw, so
  // every head turn is chased by a trunk that arrives late and settles late —
  // follow-through out of the smoothing mechanism the rig already had, with no
  // second animation system to keep in sync. Shorten this toward the head's
  // 0.16 and the two move as one rigid piece, which is the puppet read.
  t.torsoTurn = 0.44;
  return t;
})();

/**
 * Per-channel clamp bounds, applied after the layers mix and before smoothing.
 *
 * The head, mouth corners and brow angles are deliberately allowed past 1: they
 * are the channels a gesture clip adds to on top of an already-posed face, and
 * clipping them at 1 flattens the peak of every nod fired during an emotion.
 */
export const RANGE = (() => {
  const r = {};
  for (const c of CHANNELS) r[c] = [0, 1];
  for (const c of GROUPS.head) r[c] = [-1.4, 1.4];
  r.mouthCornerL = r.mouthCornerR = [-1.4, 1.4];
  r.browAngleL = r.browAngleR = [-1.4, 1.4];
  r.browRaiseL = r.browRaiseR = [-1, 1];
  r.browInnerL = r.browInnerR = [-1, 1];
  r.pupilX = r.pupilY = [-1, 1];
  r.shoulderL = r.shoulderR = [-1, 1];
  r.torsoLean = [-1, 1];
  r.torsoTurn = [-1, 1];
  return r;
})();

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function makeParams(overrides) {
  return Object.assign({}, REST, overrides);
}

/** Frame-rate independent exponential approach toward a target. */
export function approach(cur, target, tau, dt) {
  if (tau <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}
