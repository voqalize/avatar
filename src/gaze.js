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
 *   3. A blink fires on any large shift. Gaze-evoked blinks are involuntary and
 *      their absence is uncanny even though nobody can name what's wrong.
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
};

export const GAZE_NAMES = Object.keys(GAZE_TARGETS);

const HEAD_FOLLOW_TAU = 0.34; // roll only — the head lags the eyes badly, on purpose
const BLINK_THRESHOLD = 0.45; // shift magnitude that triggers a gaze-evoked blink

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
const HEAD_ACCEL = 4.0; // units/s² — sets both launch and braking firmness
const HEAD_SPEED = 0.9; // units/s — cruise cap; only long swings ever reach it

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
// There is deliberately no THINK profile. The *cognitive* aversion — 3.54 s
// (SD 1.26), splitting 39.3% down / 29.4% up / 31.3% side (§4.2) — is longer
// and deeper than the listening kind, and THINKING already renders it through
// `wander`, which moves the whole gaze target rather than nudging off it. Two
// mechanisms producing the same look would fight; the state that thinks looks
// away properly, and this profile is for the state that must not.

export class GazeLayer {
  constructor() {
    this.target = GAZE_TARGETS.USER;
    this.name = 'USER';
    this.head = { x: 0, y: 0, roll: 0 };
    this.vel = { x: 0, y: 0 };
    this.onLargeShift = null;
    this.jitter = { x: 0, y: 0 };
    this._nextMicro = 0;
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
    this._avProfileRef = undefined;
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
      return;
    }
    if (this._avUntil && t >= this._avUntil) {
      this._avUntil = 0;
      this._avNext = t + p.every[0] + Math.random() * (p.every[1] - p.every[0]);
    } else if (!this._avUntil && t >= this._avNext && !this.hold) {
      this._avUntil = t + p.dur[0] + Math.random() * (p.dur[1] - p.dur[0]);
      const d = p.dirs[(Math.random() * p.dirs.length) | 0];
      const m = p.mag[0] + Math.random() * (p.mag[1] - p.mag[0]);
      this._avVec.x = d[0] * m;
      this._avVec.y = d[1] * m;
    }
    // `hold` cancels an aversion already running, it does not merely postpone
    // the next: the turn can end mid-look, and the eyes have to be back.
    const want = this._avUntil && !this.hold ? 1 : 0;
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
   */
  set(name, override) {
    const next = override
      ? { px: override.x, py: override.y, hx: override.x * 0.42, hy: override.y * 0.36 }
      : GAZE_TARGETS[name] || GAZE_TARGETS.USER;
    const d = Math.hypot(next.px - this.target.px, next.py - this.target.py);
    this.target = next;
    this.name = override ? 'CUSTOM' : name;
    if (d > BLINK_THRESHOLD && this.onLargeShift) this.onLargeShift();
  }

  /**
   * Micro-saccades. Eyes are never still; a perfectly fixed pupil reads as
   * dead. Small, frequent, and irregular.
   */
  _micro(t, dt) {
    if (t >= this._nextMicro) {
      this._nextMicro = t + 0.7 + Math.random() * 1.6;
      this.jitter.x = (Math.random() - 0.5) * 0.16;
      this.jitter.y = (Math.random() - 0.5) * 0.11;
    }
    const decay = 1 - Math.exp(-dt / 0.5);
    this.jitter.x -= this.jitter.x * decay;
    this.jitter.y -= this.jitter.y * decay;
  }

  update(t, dt) {
    this._t = t;
    this._micro(t, dt);
    this._avert(t, dt);
    const avx = this._avVec.x * this._avAmt;
    const avy = this._avVec.y * this._avAmt;

    // Ballistic head follow: steer velocity toward "full speed at the target,
    // but never faster than can still brake to a stop within the distance
    // left". The braking bound is v² = 2·a·d solved for v, with a half-step
    // correction for discrete time (the −maxA term) so a frame never lands
    // past the target. As d shrinks the bound falls to zero, which *is* the
    // deceleration — no separate easing curve.
    const dx = this.target.hx - this.head.x;
    const dy = this.target.hy - this.head.y;
    const d = Math.hypot(dx, dy);
    const maxA = HEAD_ACCEL * dt;
    const brake = 0.5 * (Math.sqrt(maxA * maxA + 8 * HEAD_ACCEL * d) - maxA);
    const goal = Math.min(HEAD_SPEED, brake);
    let ax = (d ? (dx / d) * goal : 0) - this.vel.x;
    let ay = (d ? (dy / d) * goal : 0) - this.vel.y;
    const a = Math.hypot(ax, ay);
    if (a > maxA) { ax *= maxA / a; ay *= maxA / a; }
    this.vel.x += ax;
    this.vel.y += ay;
    // A dropped-frame dt could step past the target; land on it instead.
    // Judged on the toward-target component so a mid-retarget frame with
    // sideways velocity keeps flying rather than teleporting.
    const along = d ? ((this.vel.x * dx + this.vel.y * dy) / d) * dt : 0;
    if (along >= d && d >= 0) {
      this.head.x = this.target.hx;
      this.head.y = this.target.hy;
      this.vel.x = 0;
      this.vel.y = 0;
    } else {
      this.head.x += this.vel.x * dt;
      this.head.y += this.vel.y * dt;
    }

    // Roll stays on the exponential: its travels are tiny (≤0.55 and usually
    // ~0.08), far below where the drift tail is visible.
    const k = 1 - Math.exp(-dt / HEAD_FOLLOW_TAU);
    this.head.roll += ((this.target.roll || 0) - this.head.roll) * k;

    const pupilY = this.target.py + this.jitter.y + avy;
    // The aversion rides *on top of* the ballistic follow rather than through
    // it: it never touches `this.head`, so it cannot disturb the braking model
    // and cannot trip the large-shift blink. The head takes only a fraction of
    // what the eyes take — a brief look-away is an eye movement that the head
    // barely joins, and a head that follows it fully reads as turning away.
    const HEAD_SHARE = 0.22;
    return {
      pupilX: this.target.px + this.jitter.x + avx,
      pupilY,
      headYaw: this.head.x + avx * HEAD_SHARE,
      headPitch: this.head.y + avy * HEAD_SHARE,
      headRoll: this.head.roll,
      // The upper lid tracks the eye vertically. Without this, looking down
      // exposes a band of sclera above the iris and the avatar looks startled.
      lidBias: pupilY * 0.34,
    };
  }
}
