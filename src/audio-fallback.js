/**
 * Amplitude-driven lipsync — the degradation path.
 *
 * When cues are late, missing, or the TTS vendor can't emit them, we read the
 * audio directly with a WebAudio AnalyserNode and guess. It is obviously worse
 * than real visemes, but it is *far* better than a still mouth, it costs
 * nothing, and it keeps working when the network doesn't.
 *
 * The guess uses two cheap signals:
 *   · RMS  -> how far the mouth opens
 *   · spectral tilt -> which shape family (sibilant / open vowel / rounded)
 */

const GATE = 0.012;

export class AudioFallback {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.time = null;
    this.freq = null;
    this.level = 0;
    this.active = false;
    this._letter = 'X';
    this._holdUntil = 0;
    this._t = 0;
  }

  /** @param {MediaStream|HTMLMediaElement|AudioNode} source */
  attach(source) {
    this.detach();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    let node;
    if (source instanceof MediaStream) node = this.ctx.createMediaStreamSource(source);
    else if (source instanceof AudioNode) node = source;
    else node = this.ctx.createMediaElementSource(source);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    node.connect(this.analyser);
    // Media-element sources must still reach the speakers.
    if (!(source instanceof MediaStream)) this.analyser.connect(this.ctx.destination);

    this.time = new Uint8Array(this.analyser.fftSize);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.active = true;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this;
  }

  detach() {
    if (this.ctx) { try { this.ctx.close(); } catch (e) { /* already closed */ } }
    this.ctx = null; this.analyser = null; this.active = false; this.level = 0;
  }

  /** @returns {{letter:string,intensity:number}|null} */
  sample(dt) {
    if (!this.active) return null;
    this._t += dt;
    this.analyser.getByteTimeDomainData(this.time);
    this.analyser.getByteFrequencyData(this.freq);

    let sum = 0;
    for (let i = 0; i < this.time.length; i++) {
      const v = (this.time[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.time.length);
    this.level += (rms - this.level) * (1 - Math.exp(-dt / 0.045));

    if (this.level < GATE) { this._letter = 'X'; return { letter: 'X', intensity: 1 }; }

    // Bin edges assume ~48kHz; exact boundaries don't matter much here.
    const n = this.freq.length;
    const band = (a, b) => {
      let s = 0;
      const lo = Math.floor(n * a), hi = Math.floor(n * b);
      for (let i = lo; i < hi; i++) s += this.freq[i];
      return s / Math.max(1, hi - lo);
    };
    const low = band(0.00, 0.035);   // ~0-800 Hz
    const mid = band(0.035, 0.13);   // ~800-3k
    const high = band(0.13, 0.40);   // ~3k-9.6k
    const total = low + mid + high + 1e-6;

    let letter;
    if (high / total > 0.34) letter = 'B';                 // sibilant
    else if (low / total > 0.62) letter = this.level > 0.16 ? 'F' : 'E'; // rounded / back
    else letter = this.level > 0.20 ? 'D' : this.level > 0.09 ? 'C' : 'B';

    // Hold each guess briefly; frame-rate shape churn looks like chattering.
    if (this._t < this._holdUntil) letter = this._letter;
    else { this._letter = letter; this._holdUntil = this._t + 0.055; }

    const intensity = Math.min(1, this.level / 0.22);
    return { letter, intensity };
  }
}
