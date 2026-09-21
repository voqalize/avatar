/**
 * Gaze.
 *
 * The server sends a semantic direction; the client does the oculomotor work.
 * Three details do almost all the perceptual heavy lifting, and skipping any
 * one of them makes the face read as a puppet:
 *
 *   1. The eyes get there first. Saccades are near-instant; the head ambles
 *      after — accelerating, cruising, braking to a stop (see HEAD_ACCEL).
 *   2. The head only goes part of the way. Real people under-rotate the head
 *      and let the eyes carry the remainder.
 *   3. A blink rides a large shift. Gaze-evoked blinks are involuntary, more
 *      likely the bigger the shift (Evinger et al. 1994), and their absence
 *      is uncanny even though nobody can name what's wrong.
 *
 * A rig that states what a pose unit is in degrees (`angles`) gets the rest of
 * the eye-head system too: its own target table, where the head carries most
 * of a look and the eyes land about a third of the way off centre (Freedman &
 * Sparks; Pejsa & Andrist's gaze model), and a vestibulo-ocular reflex in the
 * mixer that holds the eyes on their target while the head moves under them.
 * Without the reflex every nod and every speech pose change is also a look
 * somewhere else.
 */

export const GAZE_TARGETS = {
  // Straight down the barrel of the webcam — the default during conversation.
  USER:     { px:  0.00, py:  0.06, hx:  0.00, hy:  0.00 },
  // Still on the user, but the head is cheated aside so an ear favors the
  // speaker — the "I'm trying to hear you" attitude. The trick is that the
  // head-follow and the pupils point OPPOSITE ways: the head turns off-axis
  // and the eyes counter back to the camera, which is what keeps it reading
  // as contact rather than as looking away. CANT_HEAR sits on this target.
  USER_EAR: { px: -0.42, py:  0.05, hx:  0.55, hy:  0.02, roll: 0.55 },
  SCREEN_CENTER: { px:  0.00, py: -0.16, hx:  0.00, hy: -0.10 },
  SCREEN_LEFT:   { px: -0.78, py: -0.10, hx: -0.36, hy: -0.05 },
  SCREEN_RIGHT:  { px:  0.78, py: -0.10, hx:  0.36, hy: -0.05 },
  SCREEN_TOP:    { px:  0.00, py: -0.72, hx:  0.00, hy: -0.30 },
  SCREEN_BOTTOM: { px:  0.00, py:  0.62, hx:  0.00, hy:  0.24 },
  SCREEN_WORK:     { px: -0.62, py:  0.18, hx: -0.26, hy:  0.12 },
  NOTES:         { px:  0.18, py:  0.72, hx:  0.04, hy:  0.28 },
  // The agent's own display, just under the camera: where anyone on a video
  // call looks while they do something for you. Eyes a little down and the
  // head barely joins, because reading your own screen is an eye movement.
  // SCREEN_WORK turned the head a quarter of the way to the left and held it
  // there for the whole task, which read as turning away from the user.
  OWN_SCREEN:    { px:  0.04, py:  0.30, hx:  0.02, hy:  0.07 },
  // The classic "recalling something" break of eye contact. Keep it for the
  // stylized "let me think" beat — audiences read up-and-away regardless of
  // whether real thinkers do it.
  AWAY_THINKING: { px: -0.58, py: -0.58, hx: -0.20, hy: -0.18, roll: 0.08 },
  AWAY_RIGHT:    { px:  0.58, py: -0.52, hx:  0.20, hy: -0.16, roll: -0.06 },
  // Where measured cognitive aversion actually goes: DOWN (39%, more than up
  // or side — docs/research-biomechanics.md §4.2). Down-left, mild enough
  // that the lid follow shades the eyes without sealing them; the head
  // carries a share so the pupils stay inside the aperture at tile size.
  AWAY_DOWN:     { px: -0.45, py:  0.42, hx: -0.18, hy:  0.20, roll: 0.04 },
  // Level and to the side: the other third of measured cognitive aversions
  // (31.3%, §4.2), neither up nor down. Right, so a thinker who alternates it
  // with AWAY_DOWN's left is not looking at the same patch of floor twice.
  AWAY_SIDE:     { px:  0.55, py:  0.08, hx:  0.20, hy:  0.03, roll: -0.03 },
};

export const GAZE_NAMES = Object.keys(GAZE_TARGETS);

const HEAD_FOLLOW_TAU = 0.34; // roll only — the head lags the eyes badly, on purpose
// Gaze-evoked blink odds, ramping with the size of the shift: none below the
// first number, certain above the second. Degrees on a rig that states them —
// stylised, well under Evinger's 10-40°, because every look here is scaled
// down to what a head-and-shoulders crop shows: a thinking look (~11°) always
// blinks, a speaker's glance aside (~5°) about a third of the time, a reading
// step never. Pose units on one that does not, where 0.45 was once a hard
// threshold and now blinks a quarter of the time.
const BLINK_RAMP_DEG = [3, 9];
const BLINK_RAMP_UNITS = [0.3, 0.9];
// The upper lid rides the eye, as a share of the pupil's travel from USER. A
// line face's lid follows down only: its lid travels further than its iris,
// and one that opened past rest on an upward look bared a band of sclera and
// read as alarm. A rig whose lid and iris travel alike follows both ways.
const LID_FOLLOW = { down: 0.34, up: 0 };
// A turning head dips. Heads travel in arcs, not on a flat plane — a turn that
// holds its pitch reads as a turntable (Williams, *The Animator's Survival
// Kit*, on head turns). A share of the turn's length, read off the yaw speed
// as v²/a — which at the middle of a braked turn *is* its length — so the dip
// peaks mid-turn, is gone when the head lands, and sizes itself on a rig whose
// head moves four times faster. A 0.75-unit look on tara sinks ~0.8°.
const HEAD_DIP = 0.06;
// How much of a drift the head joins. Little: a drift is a reader's scan or a
// thinker's gaze moving where it rests, and both are eye movements. At 0.35
// the head nodded along with every step of a reading scan, which on a
// photographic face reads as a bobbing head rather than a moving eye.
const DRIFT_HEAD = 0.12;

// Where the eyes land inside a fixation on the user: the user's two eyes and,
// less often, the mouth — the triangle a listener's gaze scans a face with.
// A fixation that sits on one point is the stare; one that visits these
// reads as someone looking at a person. Pose units at scanGain 1.
const FACE_POINTS = [[-0.05, 0], [0.05, 0], [-0.05, 0], [0.05, 0], [0, 0.07], [0, 0]];
// Default gap between those fixational saccades, seconds. Eyes Alive
// (docs/research-biomechanics.md §4.5) is that this interval differs by mode,
// so states set their own through the mixer.
const SCAN_EVERY = [0.5, 1.6];
// Fixational jumps inside a look away, as a share of the usual size. The look
// is one saccade out and one back; big jumps inside it read as searching, and
// on a rig with a large scanGain one could land the eyes back on the face
// mid-look, so the look happened and did not read.
const AVERT_SCAN = 0.35;
// The least a new fixation moves from the last, pose units at scanGain 1.
// Drawn independently, one in a few landed on the one before, and two jumps
// that go nowhere are one long stare: 6 s on a single point, measured, in the
// state that is waiting for the user to come back.
const MIN_STEP = 0.025;

// Head follow is ballistic, not exponential. An exponential chase has its peak
// velocity at t=0 and then creeps forever — motion that starts instantly and
// never quite arrives is what "drifting" looks like. A real orienting head
// accelerates, cruises, and *brakes to a stop*; the stop is the cue that
// attention has landed (docs/research-biomechanics.md §1.2 — the head's travel
// is a discrete arriving move, eyes first, head after). The constants keep the
// old τ=0.34 amble: a typical 0.3-unit shift completes in ~0.55s, USER_EAR's
// 0.55-unit swing in ~0.85s. The mixer still low-passes headYaw/headPitch at
// τ=0.16 downstream, which rounds the hard stop into a short settle — that
// cascade is deliberate, so do not "help" by softening the brake here too.
// A rig whose head unit is a few degrees sets its own (`headAccel`,
// `headSpeed`): an amble sized in line-face units took a 7° look 1.2 s.
const HEAD_ACCEL = 4.0; // units/s² — sets both launch and braking firmness
const HEAD_SPEED = 0.9; // units/s — cruise cap; only long swings ever reach it
// The head takes only a fraction of what an aversion takes — a brief look-away
// is an eye movement that the head barely joins, and a head that follows it
// fully reads as turning away. Sized for a line face, whose pupils travel far
// inside a big eye; a rig sets its own split (`avertSplit`).
const HEAD_SHARE = 0.22;

/**
 * Ballistic follow: steer velocity toward "full speed at the goal, but never
 * faster than can still brake to a stop within the distance left". The
 * braking bound is v² = 2·a·d solved for v, with a half-step correction for
 * discrete time (the −maxA term) so a frame never lands past the goal. As d
 * shrinks the bound falls to zero, which *is* the deceleration — no separate
 * easing curve.
 */
function chase(pos, vel, gx, gy, dt, accel, speed) {
  const dx = gx - pos.x;
  const dy = gy - pos.y;
  const d = Math.hypot(dx, dy);
  const maxA = accel * dt;
  const brake = 0.5 * (Math.sqrt(maxA * maxA + 8 * accel * d) - maxA);
  const goal = Math.min(speed, brake);
  let ax = (d ? (dx / d) * goal : 0) - vel.x;
  let ay = (d ? (dy / d) * goal : 0) - vel.y;
  const a = Math.hypot(ax, ay);
  if (a > maxA) { ax *= maxA / a; ay *= maxA / a; }
  vel.x += ax;
  vel.y += ay;
  // A dropped-frame dt could step past the goal; land on it instead. Judged
  // on the toward-goal component so a mid-retarget frame with sideways
  // velocity keeps flying rather than teleporting.
  const along = d ? ((vel.x * dx + vel.y * dy) / d) * dt : 0;
  if (along >= d && d >= 0) {
    pos.x = gx;
    pos.y = gy;
    vel.x = 0;
    vel.y = 0;
  } else {
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
  }
}

/**
 * Aversion profiles: a brief, deliberate break of eye contact that returns to
 * whatever the gaze target already was.
 *
 * This exists because *holding* the user's eyes is not the attentive pose it
 * looks like. Wang & Gratch (CHI 2010, n=133) ran the condition directly: a
 * virtual listener that simply stares rated no better than one that visibly
 * ignored the user (rapport 3.49 vs 3.34, n.s.), was rated the most *tense* of
 * the three conditions, and raised the speaker's own disfluency rate to
 * 36.75/min against 22.44 for a responsive listener. All three were rated
 * equally natural, so it is not an animation-quality artefact. Rossano supplies
 * the mechanism — sustained mutual gaze is a *demand for more talk*, not a
 * signal of attention (95% of sequences expanded when both parties kept looking;
 * 84% closed when both withdrew) — and Binetti (N=498) puts preferred mutual
 * gaze at 3295 ± 706 ms, which is well short of forever.
 *
 * The other wall is just as hard: sustained *aversion* is an ostracism cue, and
 * measured on an animated character (Chotpitayasunondh & Douglas, N=128) it
 * costs η²ₚ = .52–.56 with post-hoc d of 1.09–2.69, with partial inattention
 * costing most of what total inattention costs. So this is not "look away
 * sometimes" — it is a narrow band, and the numbers below are Andrist's measured
 * ones rather than a taste call (docs/research-biomechanics.md §4.2). The spike
 * that arrived at this band, and what it measured on peep, is
 * docs/research-active-listening.md.
 *
 * `every`/`dur` are seconds. `dirs` are unit-ish directions weighted by how
 * often each is taken; magnitude is scaled per-fire.
 */
export const AVERSION = {
  // Idle, and before a call: present and relaxed rather than attending. The
  // eyes rest on the user a comfortable bout (preferred mutual gaze 3.3 s,
  // §4.1) and leave for longer, softer looks than a listener's — level or a
  // little down, never up, because up is the "recalling" look and there is
  // nothing to recall. This is the first face anyone sees, and it used to
  // open looking up and to the left.
  IDLE: {
    every: [3.2, 6.0],
    dur: [1.4, 2.8],
    mag: [0.30, 0.46],
    dirs: [[-1, 0.10], [1, 0.10], [-0.8, 0.45], [0.8, 0.40], [-1, 0.25]],
  },
  // While listening: 1.14 s (SD 0.27) every 7.21 s (SD 1.88), 57.5% sideways.
  // Sideways dominates because down reads as submission and up reads as
  // exasperation on a face this schematic.
  LISTEN: {
    every: [5.3, 9.1],
    dur: [0.85, 1.45],
    mag: [0.30, 0.44],
    dirs: [[-1, 0.06], [-1, 0.06], [1, 0.02], [1, 0.02], [-0.7, -0.5], [0.5, 0.35]],
  },
};
// **There is deliberately no SPEAK profile, and that is the owner's call
// (2026-09-21): while the avatar talks, its eyes are on the user.** There was
// one — Andrist's measured speaker, a planning look away at the start of most
// turns and a short one every few seconds at a phrase boundary — and in a live
// call it read as the eyes darting off and coming back. The research it came
// from is not disputed and the reason it does not transfer is structural: a
// human speaker's look away is a *head and body* movement that the eyes only
// lead, and this rig has no such movement to give it. Eye travel on its own is
// not a smaller version of that, it is a different thing, and on tara the
// amplitude it needed to be visible at all (`aversionGain` 1.8) is exactly what
// made it read as a dart. What the speaking face moves instead is the head it
// holds per phrase and the trunk under it (prosody.js), which is communicative
// rather than evasive. If the face and body half is ever built, this is where
// the eye half comes back.
//
// There is deliberately no THINK profile either. The *cognitive* aversion —
// 3.54 s (SD 1.26), splitting 39.3% down / 29.4% up / 31.3% side (§4.2) — is longer
// and deeper than the listening kind, and THINKING renders it with its own
// dwell cycle (a `glance` in STATES), which moves the whole gaze target rather
// than nudging off it. Two mechanisms producing the same look would fight.

export class GazeLayer {
  constructor() {
    this.target = GAZE_TARGETS.USER;
    this.name = 'USER';
    this.head = { x: 0, y: 0, roll: 0 };
    this.vel = { x: 0, y: 0 };
    this.onLargeShift = null;
    this.jitter = { x: 0, y: 0 };
    this._nextMicro = 0;
    /** How far a fixational saccade travels. A pupil unit is a different
     *  angle on every rig, and one sized for a line face is invisible on a
     *  photographic one — the mixer passes the rig's `saccadeGain`. */
    this.scanGain = 1;
    /** The same for conversational aversions (AVERSION), which are sized for
     *  a line face too. On tara a speaking look-away at 1 is 2-3 px of iris
     *  travel, and a recorded call read the whole turn as a locked stare. */
    this.avertGain = 1;
    /** Where each named look goes, on this rig. The shared table is sized for
     *  a line face; a rig whose eyes are a fraction of its head's reach
     *  brings its own, where the head carries the look. */
    this.targets = GAZE_TARGETS;
    /** How an aversion divides: `eye` of it stays in the eyes, and `head` of
     *  it (in head units per pupil unit) goes to the neck. */
    this.avertSplit = { eye: 1, head: HEAD_SHARE };
    /** Degrees per pose unit, `{ eye: {x, y}, head: {x, y} }`, or null on a
     *  rig that has not said — then shifts are measured in pupil units. */
    this.angles = null;
    this.lidFollow = LID_FOLLOW;
    this.headAccel = HEAD_ACCEL;
    this.headSpeed = HEAD_SPEED;
    /** [min, max] seconds between fixational saccades, or null for the
     *  default. Set per state by the mixer. */
    this.scanEvery = null;
    this._t = 0;
    // --- aversion scheduler
    this.aversion = null;      // one of AVERSION, or null for none
    /** Set true when eye contact must be held: the floor is about to change
     *  hands. Andrist prohibits intimacy-regulating aversions near utterance
     *  end for exactly this reason — the floor is passed with mutual gaze, and
     *  an avatar that looks away as the user finishes has just declined it. */
    this.hold = false;
    this._avNext = 0;
    this._avUntil = 0;
    this._avVec = { x: 0, y: 0 };
    this._avAmt = 0;           // glided 0..1 so the return is a movement, not a cut
    this._avWant = 0;          // where _avAmt is going; the head chases this
    this._avHead = { x: 0, y: 0 };
    this._avVel = { x: 0, y: 0 };
    this._avProfileRef = undefined;
    // --- drift: a small held offset about the target, set by the mixer
    this.drift = { x: 0, y: 0 };
    this._drift = { x: 0, y: 0 };
  }

  /** Adopt an aversion profile (or null). Cheap to call every frame. */
  setAversion(p) {
    if (p === this._avProfileRef) return;
    this._avProfileRef = p;
    this.aversion = p || null;
    // Re-arm rather than inherit: a state that averts must not fire the instant
    // it is entered off a stale timestamp from one that didn't.
    this._avNext = this._t + (p ? p.every[0] + Math.random() * (p.every[1] - p.every[0]) : 0);
    this._avUntil = 0;
  }

  _avert(t, dt) {
    const p = this.aversion;
    if (!p) {
      // Glide home even after the profile is gone, so a state change mid-look
      // returns the eyes instead of snapping them.
      this._avAmt = Math.max(0, this._avAmt - dt / 0.18);
      this._avWant = 0;
      return;
    }
    if (this._avUntil && this.hold) {
      // `hold` ends a look already running, and the schedule starts over
      // behind it. Suspending the look instead sent the eyes back out the
      // moment the hold lifted — out, back and out again across one turn
      // edge, which is three saccades where the floor wanted none.
      this._avUntil = 0;
      this._avNext = t + p.every[0] + Math.random() * (p.every[1] - p.every[0]);
    } else if (this._avUntil && t >= this._avUntil) {
      this._avUntil = 0;
      this._nextMicro = 0;
      this._avNext = t + p.every[0] + Math.random() * (p.every[1] - p.every[0]);
    } else if (!this._avUntil && !this.hold && t >= this._avNext) {
      this._avUntil = t + p.dur[0] + Math.random() * (p.dur[1] - p.dur[0]);
      this._nextMicro = 0;
      const d = p.dirs[(Math.random() * p.dirs.length) | 0];
      const m = (p.mag[0] + Math.random() * (p.mag[1] - p.mag[0])) * this.avertGain;
      this._avVec.x = d[0] * m;
      this._avVec.y = d[1] * m;
      // A look away is a gaze shift like any other, and blinks by its size.
      const s = this.avertSplit;
      const out = { px: d[0] * m * s.eye, py: d[1] * m * s.eye, hx: d[0] * m * s.head, hy: d[1] * m * s.head };
      this._shiftBlink({ px: 0, py: 0, hx: 0, hy: 0 }, out);
    }
    // `hold` cancels an aversion already running, it does not merely postpone
    // the next: the turn can end mid-look, and the eyes have to be back.
    const want = this._avUntil && !this.hold ? 1 : 0;
    this._avWant = want;
    // Out fast, back slightly slower. A saccade away is ballistic; the return
    // to a face is a fraction more deliberate, and symmetric timing here is one
    // of the things that makes a rig read as a metronome.
    const rate = want ? dt / 0.055 : dt / 0.11;
    this._avAmt = want
      ? Math.min(1, this._avAmt + rate)
      : Math.max(0, this._avAmt - rate);
  }

  /** How far off-target the eyes currently are, 0..1. The mixer reads this to
   *  keep the trunk out of it — an aversion is eyes and a little head, never a
   *  body turn. */
  get averted() { return this._avAmt; }

  /**
   * @param {string} name  one of GAZE_NAMES
   * @param {{x:number,y:number}} [override] normalized -1..1 escape hatch for
   *        when the server knows exact screen coordinates
   * @param {boolean} [blink] true to ask for the evoked blink whatever the
   *        size, false to withhold it, omitted to leave it to the odds
   */
  set(name, override, blink) {
    const next = override
      ? { px: override.x, py: override.y, hx: override.x * 0.42, hy: override.y * 0.36 }
      : this.targets[name] || this.targets.USER;
    const prev = this.target;
    this.target = next;
    this.name = override ? 'CUSTOM' : name;
    if (blink !== false) this._shiftBlink(prev, next, blink);
  }

  /** Roll the gaze-evoked blink for a shift from one target to another. */
  _shiftBlink(a, b, force) {
    if (!this.onLargeShift) return;
    const g = this.angles;
    const [lo, hi] = g ? BLINK_RAMP_DEG : BLINK_RAMP_UNITS;
    const size = g
      ? Math.hypot((b.px - a.px) * g.eye.x + (b.hx - a.hx) * g.head.x,
                   (b.py - a.py) * g.eye.y + ((b.hy || 0) - (a.hy || 0)) * g.head.y)
      : Math.hypot(b.px - a.px, b.py - a.py);
    // The listener is told which of the two it is: a beat the state named
    // outranks the blink budget, a roll of the odds does not.
    //
    // A shift past `hi` is not a roll. The ramp prices those at probability 1,
    // so the odds have already decided, and the budget was overruling the
    // ramp's own certainty: on the call reel the three biggest hops a screen
    // hunt makes -- 10.9°, 9.5°, 9.4° -- reached the eyelids as a coin toss
    // that the budget then refused. A saccade that size wants every channel a
    // head turn has (research-biomechanics §1.2: yaw, a pitch dip, a blink).
    //
    // Affordable because it is only the tail. Forcing the *whole* evoked
    // population is what cost 2.12x the authored rate and is why
    // EVOKED_EARLIEST exists; this is three shifts in a minute-long run, and
    // over four seeds 78 blinks fired where the budget alone fired 79.
    //
    // The refractory is untouched and refuses half of these, because a hunt
    // retargets every 0.8-2.0 s and that is faster than 1.5 s. That is the
    // refractory working as written -- a glance out and back carries one
    // blink, not two. So this masks the isolated large look and not the
    // rapid ones inside a hunt, which stay open-eyed.
    if (force || size >= hi) this.onLargeShift(true);
    else if (Math.random() < (size - lo) / (hi - lo)) this.onLargeShift(false);
  }

  /** The lid's share of an eye at `pupilY`, added to the lid channels. */
  lidBias(pupilY) {
    const rest = GAZE_TARGETS.USER.py;
    const f = this.lidFollow;
    return rest * f.down + (pupilY - rest) * (pupilY > rest ? f.down : f.up);
  }

  /**
   * Fixational saccades. Eyes are never still, and they do not wobble about a
   * point either: they jump and *hold*, a new fixation every half second or
   * so. On the user they visit the user's eyes and mouth; anywhere else they
   * land a little way about the target. These used to decay back to the exact
   * centre within a second, so between jumps every state stared at one point,
   * and at a photographic face's scale the jumps were under a pixel —
   * §4.6's "sub-threshold jitter signals nothing", measured.
   */
  _micro(t) {
    // A state's `scan` is [min gap, max gap, amplitude]: a reader's own
    // line steps carry the movement, so a small third value keeps the
    // fixational jumps from blurring them.
    const [a, b, k = 1] = this.scanEvery || SCAN_EVERY;
    // And a state that scans faster gets it from the frame it starts, not once
    // the state before it has finished waiting. The deadline is drawn when a
    // fixation fires, under whatever cadence was in force *then*, so entering a
    // hunt out of a slower state finds a gap longer than the hunt's own maximum
    // already on the clock and spends its first second at the old rate. On a
    // two-second state that is most of the state: eyes that hold dead still and
    // then jump once, which is read as mechanical rather than as searching.
    // Clamped, not redrawn: the wait already served still counts, and a state
    // change must not cost a draw from the shared stream — every blink and
    // wander in the reel comes off it, and spending one here would move them.
    if (this._nextMicro > t + b) this._nextMicro = t + b;
    if (t < this._nextMicro) return;
    this._nextMicro = t + a + Math.random() * (b - a);
    const g = this.scanGain * k * (this._avUntil ? AVERT_SCAN : 1);
    // The face scan is for looking *at* the user. A look away is not one,
    // and a face-point offset riding on it pulled short looks back onto the
    // face — the look happened and did not read.
    const face = (this.name === 'USER' || this.name === 'USER_EAR') && !this._avUntil;
    let x = 0, y = 0;
    for (let i = 0; i < 4; i++) {
      if (face) {
        const [fx, fy] = FACE_POINTS[(Math.random() * FACE_POINTS.length) | 0];
        x = (fx + (Math.random() - 0.5) * 0.02) * g;
        y = (fy + (Math.random() - 0.5) * 0.02) * g;
      } else {
        x = (Math.random() - 0.5) * 0.12 * g;
        y = (Math.random() - 0.5) * 0.08 * g;
      }
      if (Math.hypot(x - this.jitter.x, y - this.jitter.y) >= MIN_STEP * g) break;
    }
    this.jitter.x = x;
    this.jitter.y = y;
  }

  update(t, dt) {
    this._t = t;
    this._avert(t, dt);
    this._micro(t);
    // Drift lands like a saccade — quick, then held — not as a slide.
    const kd = 1 - Math.exp(-dt / 0.04);
    this._drift.x += (this.drift.x - this._drift.x) * kd;
    this._drift.y += (this.drift.y - this._drift.y) * kd;
    const s = this.avertSplit;
    const avx = this._avVec.x * this._avAmt * s.eye + this._drift.x;
    const avy = this._avVec.y * this._avAmt * s.eye + this._drift.y;
    // The head's part of an aversion is a head movement like any other, so it
    // gets the same ballistic launch and brake as the gaze follow — on its own
    // follower, so the trunk (which tracks `this.head`) sits a look out.
    const ahx = this._avVec.x * this._avWant * s.head;
    const ahy = this._avVec.y * this._avWant * s.head;
    chase(this._avHead, this._avVel, ahx, ahy, dt, this.headAccel, this.headSpeed);
    chase(this.head, this.vel, this.target.hx, this.target.hy, dt, this.headAccel, this.headSpeed);

    // Roll stays on the exponential: its travels are tiny (≤0.55 and usually
    // ~0.08), far below where the drift tail is visible.
    const k = 1 - Math.exp(-dt / HEAD_FOLLOW_TAU);
    this.head.roll += ((this.target.roll || 0) - this.head.roll) * k;

    const vx = this.vel.x + this._avVel.x;
    const dip = HEAD_DIP * vx * vx / this.headAccel;
    return {
      pupilX: this.target.px + this.jitter.x + avx,
      pupilY: this.target.py + this.jitter.y + avy,
      headYaw: this.head.x + this._avHead.x + this._drift.x * DRIFT_HEAD,
      headPitch: this.head.y + this._avHead.y + this._drift.y * DRIFT_HEAD + dip,
      headRoll: this.head.roll,
      // Where the head is *going*, without the looks that ride on it. The
      // mixer turns the trunk toward this and not toward headYaw: an aversion
      // is eyes and a little head, never a body turn.
      trunkYaw: this.head.x,
      // Where the head will be once it lands — the pose the eyes' target was
      // authored against. The mixer's reflex holds the eyes on that target
      // against every difference between this and the head actually drawn:
      // the follow still under way, the dip, and everything above the gaze
      // layer that moves the head.
      aimYaw: this.target.hx + ahx + this._drift.x * DRIFT_HEAD,
      aimPitch: this.target.hy + ahy + this._drift.y * DRIFT_HEAD,
    };
  }
}
