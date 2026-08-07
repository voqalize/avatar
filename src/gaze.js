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

export class GazeLayer {
  constructor() {
    this.target = GAZE_TARGETS.USER;
    this.name = 'USER';
    this.head = { x: 0, y: 0, roll: 0 };
    this.vel = { x: 0, y: 0 };
    this.onLargeShift = null;
    this.jitter = { x: 0, y: 0 };
    this._nextMicro = 0;
  }

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
    this._micro(t, dt);

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

    const pupilY = this.target.py + this.jitter.y;
    return {
      pupilX: this.target.px + this.jitter.x,
      pupilY,
      headYaw: this.head.x,
      headPitch: this.head.y,
      headRoll: this.head.roll,
      // The upper lid tracks the eye vertically. Without this, looking down
      // exposes a band of sclera above the iris and the avatar looks startled.
      lidBias: pupilY * 0.34,
    };
  }
}
