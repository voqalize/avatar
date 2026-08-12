/**
 * Presence director — application-level behavior built from the avatar's
 * existing states and clips.
 *
 * This deliberately knows nothing about SVG paths or avatar-specific artwork.
 * It receives conversational and tool-lifecycle moments from the host, then
 * composes the public avatar API into readable behavior. A customer avatar
 * therefore needs only the normal rig calibration; it does not need a second
 * set of state drawings or bespoke behavioral code.
 */

export const PRESENCE_MODES = Object.freeze([
  'AVAILABLE', 'LISTENING', 'THINKING', 'WORKING', 'REVIEWING',
  'SEARCHING', 'WAITING', 'SPEAKING', 'REPAIR',
]);

export const ACKNOWLEDGEMENT_KINDS = Object.freeze([
  'CONTINUER', 'RECEIPT', 'REALIZATION', 'EMPATHY',
]);

const ACKS = Object.freeze({
  // These are eye-first understanding beats, not VAD-driven head bobs. The
  // host chooses the semantic moment; the director gives it a readable body.
  CONTINUER: { id: 'ACK_CONTINUE', cooldown: 2800, attendMs: 850 },
  RECEIPT: { id: 'ACK_RECEIVE', cooldown: 4200, attendMs: 1400 },
  // Realisation is rare: spending it on every sentence destroys its meaning.
  REALIZATION: { id: 'ACK_REALIZE', cooldown: 6500, attendMs: 1250 },
  // Empathy holds contact and acknowledges without pretending to agree.
  EMPATHY: { id: 'ACK_EMPATHIZE', cooldown: 4800, attendMs: 1450 },
});

const MODE_STATE = Object.freeze({
  AVAILABLE: ['IDLE', { emotion: 'neutral' }],
  LISTENING: ['LISTENING', { emotion: 'neutral' }],
  THINKING: ['THINKING', { emotion: 'thoughtful' }],
  REVIEWING: ['REVIEWING_SCREEN', { emotion: 'thoughtful' }],
  SEARCHING: ['SEARCHING_SCREEN', { emotion: 'thoughtful' }],
  WAITING: ['WAITING_FOR_USER', { emotion: 'encouraging' }],
  SPEAKING: ['SPEAKING', { emotion: 'neutral' }],
  REPAIR: ['TYPING_CHAT', { emotion: 'concerned' }],
});

// The work loop is intentionally made from already-authored application
// states. The host starts it only while a tool is genuinely active and stops it
// on completion/failure; it is presence during work, not decorative typing.
const WORK_CYCLE = Object.freeze([
  { state: 'TYPING', duration: 1900 },
  { state: 'REVIEWING_SCREEN', duration: 1450 },
  { state: 'TYPING', duration: 1600 },
  { state: 'SEARCHING_SCREEN', duration: 1250 },
]);

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @param {import('./avatar.js').AvatarApi} avatar
 * @param {{ now?: () => number, setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} [opts]
 */
export function createPresenceDirector(avatar, opts = {}) {
  return new PresenceDirector(avatar, opts);
}

export class PresenceDirector {
  /** @param {import('./avatar.js').AvatarApi} avatar */
  constructor(avatar, opts = {}) {
    if (!avatar || typeof avatar.setState !== 'function' || typeof avatar.action !== 'function') {
      throw new TypeError('createPresenceDirector: an AvatarApi is required');
    }
    this.avatar = avatar;
    this.now = opts.now || defaultNow;
    this._setTimeout = opts.setTimeout || globalThis.setTimeout.bind(globalThis);
    this._clearTimeout = opts.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    this.mode = 'AVAILABLE';
    this._workTimer = null;
    this._workIndex = 0;
    this._lastAck = new Map();
  }

  /** Enter one durable presence mode and cancel any incompatible work loop. */
  setMode(mode, opts = {}) {
    if (!PRESENCE_MODES.includes(mode)) throw new Error(`unknown presence mode: ${mode}`);
    if (mode !== 'WORKING') this.stopWork();
    this.mode = mode;

    if (mode === 'WORKING') {
      this.startWork();
      return this;
    }
    const def = MODE_STATE[mode];
    if (def) {
      const [state, base] = def;
      this.avatar.setState(state, { ...base, ...opts });
    }
    return this;
  }

  /**
   * Feed the director the host's VAD/endpointer verdict. This still passes the
   * raw signal to the avatar's own listening layer; the director merely makes
   * the durable attention choice explicit.
   */
  setUserSpeaking(speaking) {
    this.avatar.setUserSpeaking(speaking);
    if (speaking === true) this.setMode('LISTENING');
    return this;
  }

  /**
   * A host-confirmed conversational moment. This is intentionally separate
   * from `setUserSpeaking(false)`: not every VAD pause deserves a visible
   * reaction, whereas a clause/intent boundary often does.
   */
  acknowledge(kind = 'CONTINUER', opts = {}) {
    const key = String(kind).toUpperCase();
    const def = ACKS[key];
    if (!def) throw new Error(`unknown acknowledgement kind: ${kind}`);
    const now = this.now();
    const previous = this._lastAck.get(key) ?? -Infinity;
    if (!opts.force && now - previous < def.cooldown) return false;
    this._lastAck.set(key, now);
    // Hold user gaze through the acknowledgment when the underlying avatar
    // exposes the optional JS-level attend() seam.
    if (typeof this.avatar.attend === 'function') this.avatar.attend(opts.attendMs ?? def.attendMs ?? 900);
    this.avatar.action(def.id);
    return def.id;
  }

  /** The pre-speech beat; callers start the actual audio/cue stream afterwards. */
  beginResponse({ leadMs = 350 } = {}) {
    this.stopWork();
    this.mode = 'SPEAKING';
    this.avatar.perform([
      { t: 0, do: 'state', name: 'TAKING_FLOOR' },
      { t: 0, do: 'action', id: 'ACK_RECEIVE' },
      { t: Math.max(0, leadMs), do: 'state', name: 'SPEAKING' },
    ]);
    return this;
  }

  /** Complete a response with a readable invitation rather than falling idle. */
  endResponse({ awaitingUser = true } = {}) {
    this.setMode(awaitingUser ? 'WAITING' : 'AVAILABLE');
    return this;
  }

  /**
   * Map durable tool lifecycle to the existing visual vocabulary. Hosts with
   * richer tool events may call setMode(REVIEWING/SEARCHING) directly instead.
   */
  setToolStatus(status) {
    switch (String(status).toUpperCase()) {
      case 'WORKING': this.setMode('WORKING'); break;
      case 'REVIEWING': this.setMode('REVIEWING'); break;
      case 'SEARCHING': this.setMode('SEARCHING'); break;
      case 'THINKING': this.setMode('THINKING'); break;
      case 'COMPLETE':
        this.stopWork();
        this.setMode('WAITING');
        break;
      case 'NEEDS_INPUT':
        this.stopWork();
        this.avatar.setState('WAITING_FOR_USER', { emotion: 'curious' });
        this.mode = 'WAITING';
        break;
      case 'REPAIR': this.setMode('REPAIR'); break;
      case 'IDLE': this.setMode('AVAILABLE'); break;
      default: throw new Error(`unknown tool status: ${status}`);
    }
    return this;
  }

  /** Start the reusable independent-work loop. Calling it again is a no-op. */
  startWork() {
    if (this._workTimer !== null) return this;
    this.mode = 'WORKING';
    this._workIndex = 0;
    this._playWorkBeat();
    return this;
  }

  stopWork() {
    if (this._workTimer !== null) this._clearTimeout(this._workTimer);
    this._workTimer = null;
    return this;
  }

  _playWorkBeat() {
    const beat = WORK_CYCLE[this._workIndex];
    this.avatar.setState(beat.state, { emotion: 'neutral' });
    this._workIndex = (this._workIndex + 1) % WORK_CYCLE.length;
    this._workTimer = this._setTimeout(() => {
      this._workTimer = null;
      if (this.mode === 'WORKING') this._playWorkBeat();
    }, beat.duration);
  }

  destroy() { this.stopWork(); }
}
