/**
 * Gesture clip player.
 *
 * A clip is a short, multi-channel keyframed timeline. Clip channels are
 * *additive deltas*, not absolute poses — a nod adds pitch to whatever the head
 * is already doing, which is what makes "nod while speaking" work without any
 * special-casing.
 *
 * A server action is a physical movement, not an abstract state transition.
 * Queued actions finish their landing before the next action begins; their
 * underlying state may change freely while that happens. `stop()` remains for
 * real speech taking mouth ownership.
 */

import { clamp } from './params.js';
import { INTERJECTION_TRACK_TAIL_MS } from './speech-timing.js';
import { VisemeTrack } from './visemes.js';

const smoothstep = (t) => t * t * (3 - 2 * t);

function sampleTrack(keys, u) {
  if (!keys.length) return 0;
  if (u <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (u >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const k = t1 === t0 ? 1 : smoothstep((u - t0) / (t1 - t0));
      return v0 + (v1 - v0) * k;
    }
  }
  return last[1];
}

const RAMP_IN = 70;
const RAMP_OUT = 150;

export class ClipPlayer {
  /**
   * @param {object} hooks
   * @param {(name:string|null)=>void} hooks.onGaze  clip-scoped gaze override
   * @param {()=>void}                 hooks.onBlink
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.clip = null;
    this.t = 0;
    this.fading = false;
    this.fadeT = 0;
    this.mouth = new VisemeTrack();
    this._blinksDone = 0;
    this.onEnd = null;
    this.queue = [];
  }

  get playing() { return !!this.clip; }
  get id() { return this.clip ? this.clip.id : null; }

  /**
   * @param {object} clip
   * @param {HTMLAudioElement} [audio] if given, the clip's mouth track is
   *        scheduled against the audio clock instead of the local timer
   */
  play(clip, audio, { queue = false } = {}) {
    if (!clip) return;
    if (this.clip && queue) {
      if (this.clip.id === clip.id || this.queue.some((item) => item.clip.id === clip.id)) return;
      this.queue.push({ clip, audio });
      return;
    }
    this._start(clip, audio);
  }

  _start(clip, audio) {
    this.clip = clip;
    this.t = 0;
    this.fading = false;
    this.fadeT = 0;
    this._blinksDone = 0;
    this.audio = audio || null;

    if (clip.mouthCues && clip.mouthCues.length) {
      const clock = audio
        ? () => audio.currentTime * 1000
        : () => this.t;
      this.mouth.tailMs = INTERJECTION_TRACK_TAIL_MS;
      this.mouth.start(clip.mouthCues, clock);
    } else {
      this.mouth.stop();
    }
    if (clip.gaze && this.hooks.onGaze) this.hooks.onGaze(clip.gaze);
    if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
  }

  /** Barge-in. Fades rather than cutting, so the head doesn't snap. */
  stop(immediate = false) {
    if (!this.clip) return;
    if (immediate) return this._end();
    this.fading = true;
    this.fadeT = 0;
  }

  _end() {
    const had = this.clip;
    this.clip = null;
    this.fading = false;
    this.mouth.stop();
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if (had && had.gaze && this.hooks.onGaze) this.hooks.onGaze(null);
    if (this.onEnd) this.onEnd(had);
    const next = this.queue.shift();
    if (next) this._start(next.clip, next.audio);
  }

  /**
   * @returns {{delta: object, weight: number, mouth: object|null, ownsMouth: boolean}}
   */
  update(dtMs) {
    if (!this.clip) return { delta: null, weight: 0, mouth: null, ownsMouth: false };
    this.t += dtMs;
    const c = this.clip;
    const u = clamp(this.t / c.duration);

    let w = Math.min(1, this.t / RAMP_IN) * Math.min(1, (c.duration - this.t) / RAMP_OUT);
    if (this.fading) {
      this.fadeT += dtMs;
      w *= Math.max(0, 1 - this.fadeT / 110);
      if (this.fadeT >= 110) { this._end(); return { delta: null, weight: 0, mouth: null, ownsMouth: false }; }
    }
    w = clamp(w);

    if (c.blinkAt && this.hooks.onBlink) {
      while (this._blinksDone < c.blinkAt.length && u >= c.blinkAt[this._blinksDone]) {
        this._blinksDone++;
        this.hooks.onBlink();
      }
    }

    const delta = {};
    for (const ch in c.keys) delta[ch] = sampleTrack(c.keys[ch], u) * w;

    let mouth = null;
    const ownsMouth = !!(c.mouthCues && c.mouthCues.length);
    if (ownsMouth) mouth = this.mouth.sample();

    if (this.t >= c.duration && !this.fading) {
      // Let the mouth track finish its tail before tearing down.
      if (!ownsMouth || !this.mouth.playing) this._end();
    }

    return { delta, weight: w, mouth, ownsMouth };
  }
}
