/**
 * Hold-and-move: how a head spends a conversation.
 *
 * Watch a person on a video call with the sound off and the head is almost
 * never *moving*. It is held, and every second or two it goes somewhere else
 * — a quick, decided move of a few degrees, a short settle, and then still
 * again. Speech adds strokes on top: a nod on a stressed word, down and back,
 * over in a third of a second. What it never does is glide, and gliding is
 * the one thing a stack of smoothed envelopes can do. That stack is what this
 * replaced: beats, a phrase drift and a lead-in, each a linear keyframe curve,
 * summed and then low-passed at the head's 160 ms, drew a head in continuous
 * motion from the first word to the last. A video reviewer called it a
 * screensaver (apps/authoring/tools/video-review/, 2026-09-12), and that is
 * the right word: every part was a movement the literature measured, and the
 * sum was a movement nobody makes.
 *
 * So this keeps the *events* the research found — a head that moves before the
 * voice, beats on stressed vowels, the settle as a phrase ends — and changes
 * what an event is:
 *
 *  - A **move** takes the held pose somewhere new along a minimum-jerk path,
 *    the profile a practised human reach follows (Flash & Hogan 1985): it
 *    starts and stops at zero velocity and acceleration, and nearly all of its
 *    travel is in the middle. It arrives, and then the pose is exactly still.
 *  - A **stroke** is a pulse on top of the held pose: out fast, back a little
 *    slower, and nothing left over when it is done.
 *
 * Between those the output does not change at all, and that stillness is the
 * point: it is what makes the moves read as decisions.
 *
 * Times are ms on whatever clock the owner keeps; this only needs it to be
 * monotonic.
 */

/** Minimum-jerk position for a normalised time in [0, 1]. */
export const minJerk = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (10 + x * (-15 + 6 * x)));

/**
 * Fold `x` into ±`limit` without a corner: identity up to `KNEE` of the way
 * there, then an exponential approach that reaches the limit only in the
 * limit. It is memoryless — the same input gives the same output whenever it
 * arrives — so nothing it touches is re-timed, which is what lets it sit in a
 * chain whose curves are all authored against a known smoothing.
 *
 * A hard clamp was the obvious thing and is wrong here: what wants limiting is
 * a sum of layers that each stay small and occasionally point the same way, so
 * a clamp would be invisible for a minute and then hold the head perfectly
 * still at the stop for half a second — the one thing a held pose must not do,
 * because stillness is how this file says "decided". The knee sits at 0.7
 * because below it the pose passes through untouched, and a recorded minute of
 * either conversational state spends its median there.
 */
const KNEE = 0.7;
export const soften = (x, limit) => {
  const a = KNEE * limit;
  const m = Math.abs(x);
  if (!(limit > 0) || m <= a) return x;
  return Math.sign(x) * (a + (limit - a) * (1 - Math.exp(-(m - a) / (limit - a))));
};

export const HEAD_AXES = ['headYaw', 'headPitch', 'headRoll'];
const ZERO = Object.freeze({ headYaw: 0, headPitch: 0, headRoll: 0 });

export class HeadPose {
  constructor() {
    // The held pose as a list of moves, each starting where the one before it
    // had got to. A move may be booked ahead of time (a head moves before the
    // voice it anticipates), so the next one can be waiting while this one
    // plays.
    this._moves = [{ at: -Infinity, dur: 0, from: ZERO, to: ZERO }];
    this._strokes = [];
  }

  /** The pose the head will hold once every booked move has landed. */
  get aim() {
    return this._moves[this._moves.length - 1].to;
  }

  /**
   * Go to `pose` (missing axes keep where they are), starting at `at` and
   * arriving `dur` ms later. A move booked to start before one already
   * booked replaces it: the later plan wins, from wherever the head will be.
   */
  moveTo(pose, at, dur) {
    while (this._moves.length > 1 && this._moves[this._moves.length - 1].at > at) this._moves.pop();
    const from = this._held(at);
    this._moves.push({ at, dur: Math.max(1, dur), from, to: { ...from, ...pose } });
  }

  /** A pulse of `add` (per axis) that peaks `attack` ms after `at` and is gone `release` ms later. */
  stroke(add, at, attack, release) {
    this._strokes.push({ add, at, attack, release });
  }

  /** Drop every stroke that has not begun by `now`; the ones under way finish. */
  cancelStrokes(now) {
    this._strokes = this._strokes.filter((s) => s.at <= now);
  }

  /** True when nothing is booked or playing after `now`: the head is holding. */
  still(now) {
    const m = this._moves[this._moves.length - 1];
    return now >= m.at + m.dur && this._strokes.every((s) => now >= s.at + s.attack + s.release);
  }

  /** The head's offset at `now`, per axis. */
  sample(now) {
    // A move whose successor has started can no longer be seen.
    while (this._moves.length > 1 && this._moves[1].at <= now) this._moves.shift();
    this._strokes = this._strokes.filter((s) => now < s.at + s.attack + s.release);
    const out = this._held(now);
    for (const s of this._strokes) {
      const t = now - s.at;
      if (t <= 0) continue;
      const e = t < s.attack ? minJerk(t / s.attack) : 1 - minJerk((t - s.attack) / s.release);
      for (const k in s.add) out[k] += e * s.add[k];
    }
    return out;
  }

  /** The held pose at `t`, strokes left out: where the head *is*, not what it is doing. */
  held(t) {
    return this._held(t);
  }

  _held(t) {
    let m = this._moves[0];
    for (const n of this._moves) if (n.at <= t) m = n;
    const k = minJerk((t - m.at) / m.dur);
    const out = {};
    for (const c of HEAD_AXES) out[c] = m.from[c] + (m.to[c] - m.from[c]) * k;
    return out;
  }
}
