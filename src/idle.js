/**
 * The always-on liveness layer: breathing, blinking, and a slow head drift.
 *
 * This is the cheapest layer to build and the one people notice most. A face
 * that holds perfectly still for two seconds looks like a crashed process, so
 * this layer never stops running — not even in DEGRADED.
 *
 * Output is *additive* (except blink, which takes a max against the base lid
 * value so a blink always closes fully regardless of the current squint).
 *
 * What the layer does is state-shaped but the layer itself is state-blind: it
 * renders a PROFILE (below), and the states table in avatar.js decides which
 * profile is in force. Blink rate alone separates listening from thinking from
 * busy at a glance — docs/research-biomechanics.md §5: conversation ~16/min,
 * cognitive work ~25/min, visual task ~9/min. It is the cheapest state
 * differentiation the rig has.
 */

import { approach } from './params.js';

/**
 * An idle profile. Every state carries one (sparse — missing keys mean these
 * defaults). Rates may jump between states; *amplitudes* glide over ~1s inside
 * the layer, because an oscillator whose amplitude steps is a visible pop.
 *
 *   sway        0..~1.2  head-drift / brow-drift / shoulder / torso amplitude
 *   blinkGap    [min,max] seconds between spontaneous blinks
 *   breathRate  multiplier on the 0.23 Hz resting cycle (13.8/min)
 *   breathAmp   breath excursion scale; cognitive load = faster AND shallower
 *   hold        { every:[s,s], dur:[s,s] } — freeze the sway (breath continues).
 *               Limited animation's static hold: deliberate stillness read as
 *               attention, and a bitrate saving besides.
 *   rhythm      { amp, freq } — quasi-rhythmic alternating shoulder work in
 *               burst/pause phrasing; the "busy at the keyboard" tell.
 *   flick       { amp, every:[s,s] } — a rare, tiny, fast-dying yaw wiggle:
 *               the "no, not this one" of someone hunting through options.
 *               Deliberately quick (a flick, not a shake — the 1.5 Hz
 *               impatience line is about sustained nodding, and this dies in
 *               half a second).
 *   shift       [s,s] gap between postural weight shifts, or null to sit
 *               perfectly still. Amplitude rides on `sway`, which is how the
 *               cognitive states get the measured sway *suppression* under
 *               load (§6.2) without a second knob.
 */
export const DEFAULT_PROFILE = {
  sway: 1.0,
  blinkGap: [1.9, 5.4],
  breathRate: 1.0,
  breathAmp: 1.0,
  hold: null,
  rhythm: null,
  flick: null,
  shift: [9, 22],
};

const rand = ([a, b]) => a + Math.random() * (b - a);

/**
 * Postural weight shift: the one part of this layer that is not periodic, and
 * the part that does most of the work.
 *
 * Everything else here is an oscillator, and an oscillator cannot make a body
 * look alive across a thirty-second hold. Fast enough to notice and it reads
 * as rocking; slow enough not to and it is indistinguishable from a still
 * image. A motion map of the listening state (tools/motion.mjs) showed the
 * outer edge of the torso travelling zero pixels over 24 seconds — the sway
 * was there in the numbers and rendered as nothing at all.
 *
 * What a seated person actually does is re-settle: every 15-40 seconds the
 * trunk arrives at a slightly different resting posture over a second or two
 * and then *stays* there. Discrete, aperiodic, and mostly holding still, which
 * is also why it costs almost nothing to encode — the motion is rare rather
 * than small.
 *
 * The counter-turn is the detail that makes it read as a body rather than a
 * drift: the trunk goes one way and the head yaws slightly the other, because
 * a person shifting their weight keeps looking at the person they are
 * listening to. Without it the whole figure slides sideways as one piece.
 */
const ZERO_POSTURE = { torsoTurn: 0, torsoLean: 0, headRoll: 0, headYaw: 0, shoulderL: 0, shoulderR: 0 };
const POSTURE_KEYS = Object.keys(ZERO_POSTURE);

function nextPosture(prev) {
  // A magnitude with a floor, and a side chosen against wherever the body
  // already is. The obvious version — draw each channel uniformly about zero —
  // was written first and measured worse than no shift at all: half the draws
  // land near the posture already held, so half the re-settles go nowhere, and
  // a mechanism that is invisible half the time reads as a body that only
  // moves sometimes. Nobody shifts their weight by a millimetre. The 25% that
  // stays on the same side is what keeps it off a left-right metronome.
  const mag = 0.16 + Math.random() * 0.26;
  const away = prev.torsoTurn > 0 ? -1 : prev.torsoTurn < 0 ? 1 : (Math.random() < 0.5 ? -1 : 1);
  const turn = mag * (Math.random() < 0.75 ? away : -away);
  const leanAway = prev.torsoLean > 0 ? -1 : 1;
  const drop = Math.random() * 0.09 - 0.03;
  return {
    torsoTurn: turn,
    torsoLean: (0.03 + Math.random() * 0.05) * leanAway,
    // The head tips slightly against the trunk, and yaws slightly against it
    // too, because a person shifting their weight goes on looking at the
    // person they are listening to. Without the counter-turn the whole figure
    // slides sideways in one piece, which is a camera move, not a body.
    headRoll: turn * -0.28 + (Math.random() * 0.10 - 0.05),
    headYaw: turn * -0.13,
    shoulderL: drop + turn * 0.07,  // weight onto one side lifts that shoulder
    shoulderR: drop - turn * 0.07,
  };
}

/** Ease so the shift has no corners at either end — a weight shift accelerates
 *  and settles, and a linear ramp between two postures reads as a slide. */
const smoothstep = (x) => x * x * (3 - 2 * x);

export class IdleLayer {
  constructor() {
    this.t = 0;
    this.enabled = true;
    this.profile = DEFAULT_PROFILE;
    this._profileRef = undefined;
    // How much the avatar is talking, 0..1, set by the mixer. Speech does not make
    // the head *busier* — sway still drops — it moves the liveness down into
    // the shoulders and torso, which is where a speaking body actually moves.
    this.talk = 0;
    this._nextBlink = 2 + Math.random() * 3;
    this._blinkT = -1;
    this._blinkDur = 0.13;
    this._double = false;
    // Two incommensurate frequencies per axis so the sway never visibly loops.
    this._ph = [Math.random() * 9, Math.random() * 9, Math.random() * 9];
    // Glided amplitudes (profiles set the target, these chase it).
    this._sway = 1;
    this._breathAmp = 1;
    // Breath is a phase integrator, not sin(t*f): rate changes must bend the
    // cycle, not teleport it.
    this._breathPh = Math.random() * Math.PI * 2;
    // Static-hold machine. _holdAmp glides 1 -> 0 -> 1 around each hold.
    this._holdUntil = 0;
    this._nextHold = 0;
    this._holdAmp = 1;
    // Work-rhythm burst/pause machine.
    this._rhythmOn = false;
    this._rhythmFlip = 0;
    this._rhythmAmp = 0;
    // Flick machine: _flickT is time-into-flick, <0 = idle.
    this._flickAt = 0;
    this._flickT = -1;
    // Weight-shift machine: a posture the body is easing from, one it is
    // easing to, and a long wait in between.
    this._postFrom = ZERO_POSTURE;
    this._postTo = ZERO_POSTURE;
    this._shiftAt = 8;
    this._shiftT0 = -1;
    this._shiftDur = 2;
    // Speech phrasing: a slow gain the talking body's excursion rides on, so
    // it comes in waves rather than as a steady hum.
    this._phrase = 0;
    this._phraseFlip = 0;
    this._phraseTo = 1;
    // Global amplitude on everything this layer emits. The honest answer to
    // "keep idle motion cheap": a deployment that composites the avatar into
    // an encoded stream turns it down, rather than the default being frozen.
    this.gain = 1;
  }

  /** Adopt a (sparse) profile. Cheap to call every frame; same ref is a no-op. */
  setProfile(p) {
    if (p === this._profileRef) return;
    this._profileRef = p;
    this.profile = Object.assign({}, DEFAULT_PROFILE, p || {});
    // Re-arm the hold scheduler so a state that uses holds doesn't inherit a
    // stale far-future timestamp from one that doesn't.
    this._nextHold = this.t + (this.profile.hold ? rand(this.profile.hold.every) : 0);
    this._flickAt = this.t + (this.profile.flick ? rand(this.profile.flick.every) : 0);
    // A shift already under way is left alone: interrupting a weight shift
    // half-finished is a lurch, and states change far more often than the
    // body re-settles.
    if (this._shiftT0 < 0) {
      this._shiftAt = this.t + (this.profile.shift ? rand(this.profile.shift) * 0.6 : 0);
    }
  }

  /** Force a blink now — used on gaze shifts and state transitions. */
  blink(double = false) {
    if (this._blinkT >= 0) return;
    this._blinkT = 0;
    this._double = double;
    this._blinkDur = 0.11 + Math.random() * 0.04;
  }

  /** A slow, deliberate blink — reads as thinking or fatigue. */
  slowBlink() {
    if (this._blinkT >= 0) return;
    this._blinkT = 0;
    this._double = false;
    this._blinkDur = 0.34;
  }

  _blinkValue(dt) {
    if (this._blinkT < 0) return 0;
    this._blinkT += dt;
    const d = this._blinkDur;
    const p = this._blinkT / d;
    if (p >= 1) {
      if (this._double) { this._double = false; this._blinkT = 0; return 0; }
      this._blinkT = -1;
      return 0;
    }
    // Fast close (35% of the window), slower reopen. Symmetric blinks look robotic.
    return p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65;
  }

  update(dt) {
    if (!this.enabled) return { add: {}, blink: 0 };
    this.t += dt;
    const t = this.t;
    const pr = this.profile;

    if (t >= this._nextBlink) {
      this._nextBlink = t + rand(pr.blinkGap);
      // Roughly one blink in six comes in a pair.
      this.blink(Math.random() < 0.16);
    }
    const blink = this._blinkValue(dt);

    // Static hold: sway freezes, breath does not — held breath reads as alarm.
    if (pr.hold) {
      if (t >= this._nextHold && t >= this._holdUntil) {
        this._holdUntil = t + rand(pr.hold.dur);
        this._nextHold = this._holdUntil + rand(pr.hold.every);
      }
    } else {
      this._holdUntil = 0;
    }
    this._holdAmp = approach(this._holdAmp, t < this._holdUntil ? 0 : 1, 0.18, dt);

    // Amplitudes glide; rates jump. (~1s ramp keeps profile changes silent.)
    this._sway = approach(this._sway, pr.sway, 1.0, dt);
    this._breathAmp = approach(this._breathAmp, pr.breathAmp, 1.0, dt);
    const a = this._sway * this._holdAmp * this.gain;
    // The weight shift takes the profile's amplitude but NOT the hold: a hold
    // freezes the body where it is, and multiplying a posture by a decaying
    // hold factor would spring it back to centre instead.
    const ps = this._sway * this.gain;

    this._breathPh += dt * 0.23 * pr.breathRate * Math.PI * 2;
    const breath = (Math.sin(this._breathPh) + 1) * 0.5 * this._breathAmp;

    // Weight shift. Never starts inside a static hold — the hold is the state
    // saying "this body is concentrating", and a re-settle mid-hold undoes it.
    let post = ZERO_POSTURE;
    if (pr.shift) {
      if (this._shiftT0 < 0 && t >= this._shiftAt && t >= this._holdUntil) {
        this._shiftT0 = t;
        this._shiftDur = 1.5 + Math.random() * 1.6;
        this._postFrom = this._postTo;
        this._postTo = nextPosture(this._postTo);
      }
      if (this._shiftT0 >= 0) {
        const k = (t - this._shiftT0) / this._shiftDur;
        if (k >= 1) {
          this._shiftT0 = -1;
          this._shiftAt = t + rand(pr.shift);
          post = this._postTo;
        } else {
          const e = smoothstep(k);
          post = {};
          for (const c of POSTURE_KEYS) {
            post[c] = this._postFrom[c] + (this._postTo[c] - this._postFrom[c]) * e;
          }
        }
      } else post = this._postTo;
    } else {
      // A state that shifts nothing still has to come home from wherever the
      // last one left the body, or the posture sticks across the transition.
      this._postTo = this._postFrom = ZERO_POSTURE;
    }

    // Speech phrasing: the talking body's excursion swells and subsides over
    // 0.6-1.6 s rather than humming at a constant level. Speech is phrased and
    // a body pushing it is phrased with it; a steady oscillation while talking
    // is the single most robotic thing this layer could do.
    if (t >= this._phraseFlip) {
      this._phraseFlip = t + 0.6 + Math.random() * 1.0;
      this._phraseTo = 0.45 + Math.random() * 0.85;
    }
    this._phrase = approach(this._phrase, this._phraseTo, 0.35, dt);

    const s = (i, f) => Math.sin(t * f * Math.PI * 2 + this._ph[i]);

    // Work rhythm: bursts of alternating-shoulder movement with pauses between,
    // because continuous oscillation reads as rocking and phrased oscillation
    // reads as *doing something*. Authored ~3x the intended excursion: at
    // ~2.2 Hz the shoulders' 0.19s tau attenuates the target to ~0.36 of it.
    let workL = 0, workR = 0, workPitch = 0;
    if (pr.rhythm) {
      if (t >= this._rhythmFlip) {
        this._rhythmOn = !this._rhythmOn;
        this._rhythmFlip = t + (this._rhythmOn ? 0.5 + Math.random() * 0.7 : 0.35 + Math.random() * 0.55);
      }
      this._rhythmAmp = approach(this._rhythmAmp, this._rhythmOn ? pr.rhythm.amp : 0, 0.15, dt);
      const w = Math.sin(t * pr.rhythm.freq * Math.PI * 2) * this._rhythmAmp;
      workL = w;
      workR = -w * 0.85;
      // A trace of the same activity in the head — eyes tracking the work.
      workPitch = Math.sin(t * pr.rhythm.freq * 1.6 * Math.PI * 2) * this._rhythmAmp * 0.16;
    } else {
      this._rhythmAmp = 0;
    }

    // The "not this one" flick: two fast wiggles dying exponentially. Authored
    // ~2.5x the intended excursion — at ~2.3 Hz the head's 0.16s tau renders
    // roughly 0.4 of the target.
    let flickYaw = 0;
    if (pr.flick) {
      if (this._flickT < 0 && t >= this._flickAt) this._flickT = 0;
      if (this._flickT >= 0) {
        this._flickT += dt;
        const ft = this._flickT;
        if (ft > 0.6) {
          this._flickT = -1;
          this._flickAt = t + rand(pr.flick.every);
        } else {
          flickYaw = pr.flick.amp * Math.sin(ft * 2.3 * Math.PI * 2) * Math.exp(-ft / 0.18);
        }
      }
    } else {
      this._flickT = -1;
    }

    // Speech moves the body more, and in waves. `talk` says whether sound is
    // being produced, `_phrase` says how hard this stretch of it is being
    // pushed.
    const say = this.talk * this._phrase;

    return {
      blink,
      add: {
        // Sway frequencies run ~1.6x the original set and amplitudes ~2x.
        // docs/research-biomechanics.md §6.2 recorded the old numbers as
        // deliberately about a quarter of measured human sway, traded for
        // encoder cost; at that setting the head's whole idle excursion
        // rendered as half a pixel at call-tile size, which is not a quiet
        // motion but no motion. This lands nearer half speed — still well
        // below the 0.04-0.6 Hz seated trunk band, still calm, but now
        // actually present on screen. `gain` is where a deployment that
        // really is paying for the pixels turns it back down.
        headYaw: (s(0, 0.094) * 0.6 + s(0, 0.058) * 0.4) * 0.075 * a
          + flickYaw + post.headYaw * ps,
        headPitch: (s(1, 0.072) * 0.6 + s(1, 0.046) * 0.4) * 0.055 * a + workPitch,
        headRoll: s(2, 0.061) * 0.048 * a + post.headRoll * ps,
        breath: breath * this.gain,
        // The brows are never quite still either.
        browRaiseL: s(0, 0.089) * 0.020 * a,
        browRaiseR: s(1, 0.083) * 0.020 * a,
        // Shoulders, and the body's share of speech emphasis — a head that
        // moves on its own above a torso that never does is the head-on-a-stick
        // read, and it was the loudest note in the first round of stakeholder
        // feedback. The slow pair of frequencies is deliberate now that the
        // amplitude is big enough to see: the old 0.31 Hz term was inaudible at
        // 0.012 and would have read as a twitch at 0.04.
        // Note which factor each term takes. The idle drift is scaled by `a`,
        // so a state that asks for stillness gets it. The speech term is NOT:
        // states that speak lower their `sway` on purpose (SPEAKING sits at
        // 0.55, because the head should not wander while the mouth is the thing
        // being watched), and running the body's share of speech through that
        // same number costs a third of it — measured, same seed, 30 s of
        // SPEAKING: shoulder line travels 6 px gated against 9 px here, and the
        // torso band's mean luminance range falls 28 -> 24. Sway suppression is
        // a statement about drift. Speech reorganises the body; it does not
        // park it.
        shoulderL: (s(1, 0.11) * 0.5 + s(2, 0.22) * 0.5) * (0.040 * a + 0.10 * say * this.gain)
          + workL + post.shoulderL * ps,
        shoulderR: (s(2, 0.10) * 0.5 + s(0, 0.19) * 0.5) * (0.040 * a + 0.10 * say * this.gain)
          + workR + post.shoulderR * ps,
        torsoLean: s(0, 0.085) * (0.028 * a + 0.075 * say * this.gain) + post.torsoLean * ps,
        // The trunk's own drift, small next to the weight shift that dominates
        // this channel. It exists so the body is not perfectly still *between*
        // shifts, which would make each shift read as a discrete event.
        torsoTurn: (s(2, 0.047) * 0.6 + s(1, 0.031) * 0.4) * 0.06 * a
          + post.torsoTurn * ps,
      },
    };
  }
}

/**
 * The listening engine is now deliberately posture-only.
 *
 * `setUserSpeaking()` receives Pipecat's VAD verdict through the client
 * adapter. It may alter the sustained engagement lean, but it never chooses or
 * fires a clip: a nod, brow acknowledgement or any other facial claim of
 * understanding is an explicit backend/application `action()` decision.
 */
export class ListeningEngine {
  constructor() {
    this.enabled = false;
    this.t = 0;
    this.engage = 0;
    this._hasSignal = false;
    this._explicit = null;
    this._speaking = false;
    this._silentAt = 0;
  }

  /** Compatibility no-ops retained for existing hosts that reached these
   * internals indirectly. With no autonomous clips there is nothing to reset
   * or cede. */
  cede() {}
  get ceded() { return false; }
  reset() {}

  /** Pipecat VAD's user-speaking truth. `null` removes the engagement signal. */
  setUserSpeaking(b) {
    if (b !== null) this._hasSignal = true;
    this._explicit = b === null ? null : !!b;
  }

  get speaking() { return this._explicit === true; }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const speaking = this.speaking;

    // Engagement: quick to lean in when the user starts, slow to give it up —
    // relaxing the moment they pause would read as relief that they stopped.
    if (speaking !== this._speaking) {
      this._speaking = speaking;
      if (!speaking) this._silentAt = t;
    }
    const engaged = speaking || t - this._silentAt < 8;
    this.engage = approach(this.engage, engaged && this._hasSignal ? 1 : 0,
      speaking ? 1.5 : 6.0, dt);
  }
}
