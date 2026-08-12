/**
 * Behavior catalog and controller.
 *
 * This is the layer between factual/wire inputs and a renderer. It deliberately
 * preserves the legacy SVG implementation names for now, but those names are
 * no longer what AvatarClient or the wire contract address directly.
 */

/** Durable states the behavior layer resolves. */
export const BEHAVIOR_STATES = Object.freeze({
  IDLE: { renderState: 'IDLE' },
  LISTENING: { renderState: 'LISTENING' },
  THINKING: { renderState: 'THINKING' },
  // Current implementation policy. The behavior state is WORKING; TYPING is
  // merely its first renderer activity and may be replaced by a work program.
  WORKING: { renderState: 'TYPING' },
  SPEAKING: { renderState: 'SPEAKING' },
  DEGRADED: { renderState: 'DEGRADED' },
  OFFLINE: { renderState: 'OFFLINE' },
  // Render-state aliases kept only for the existing SVG implementation and
  // direct local tooling. Wire/lifecycle code addresses the core IDs above.
  TYPING: { renderState: 'TYPING' },
  REVIEWING_SCREEN: { renderState: 'REVIEWING_SCREEN' },
  WAITING_FOR_USER: { renderState: 'WAITING_FOR_USER' },
  TYPING_CHAT: { renderState: 'TYPING_CHAT' },
  DISTRACTED: { renderState: 'DISTRACTED' },
  SEARCHING_SCREEN: { renderState: 'SEARCHING_SCREEN' },
  CANT_HEAR: { renderState: 'CANT_HEAR' },
  TAKING_FLOOR: { renderState: 'TAKING_FLOOR' },
  WANTS_IN: { renderState: 'WANTS_IN' },
  YIELDED: { renderState: 'YIELDED' },
});

export const BEHAVIOR_STATE_IDS = Object.freeze(Object.keys(BEHAVIOR_STATES));

/** Library action IDs. These are broader and more readable than the wire. */
export const BEHAVIOR_ACTIONS = Object.freeze({
  'ack.receive': { renderAction: 'ACK_RECEIVE' },
  'ack.nod': { renderAction: 'ACK_NOD' },
  'turn.interrupted': { renderAction: 'RESPONSE_INTERRUPTED' },
  'gesture.greet': { renderAction: 'GESTURE_GREET' },
  'gesture.farewell': { renderAction: 'GESTURE_GOODBYE' },
  'gesture.approve': { renderAction: 'GESTURE_APPROVE' },
  'gesture.wait': { renderAction: 'GESTURE_WAIT' },
});

export const BEHAVIOR_ACTION_IDS = Object.freeze(Object.keys(BEHAVIOR_ACTIONS));

/**
 * Client-owned activity programs. Activities are selections made while a
 * durable state remains effective; they are not server commands. The initial
 * WORKING program intentionally has one visible choice so output is unchanged.
 * Adding notes/secondary-screen variants later changes this table only.
 */
export const STATE_PROGRAMS = Object.freeze({
  WORKING: {
    activities: ['work.type'],
    repeatMs: [2_200, 3_200],
  },
});

export const BEHAVIOR_ACTIVITIES = Object.freeze({
  'work.type': { renderState: 'TYPING' },
  // Reserved library activities. They are intentionally not selectable until
  // their action timelines have been authored and reviewed across all rigs.
  'work.review_notes': { renderState: 'REVIEWING_SCREEN' },
  'work.secondary_screen': { renderState: 'REVIEWING_SCREEN' },
});

/** Stable, promoted wire names map into the behavior catalog here and nowhere else. */
export const WIRE_ACTION_TO_BEHAVIOR = Object.freeze({
  ACK_RECEIVE: 'ack.receive',
  ACK_NOD: 'ack.nod',
  RESPONSE_INTERRUPTED: 'turn.interrupted',
  GESTURE_GREET: 'gesture.greet',
  GESTURE_GOODBYE: 'gesture.farewell',
  GESTURE_APPROVE: 'gesture.approve',
  GESTURE_WAIT: 'gesture.wait',
});

/**
 * Turns behavior intent into the legacy SVG mixer's calls. A future renderer
 * receives the same intent through its own adapter; it does not need to know
 * the legacy state/action names used below.
 */
export class BehaviorController {
  constructor(avatar, opts = {}) {
    if (!avatar || typeof avatar.setState !== 'function' || typeof avatar.action !== 'function') {
      throw new TypeError('BehaviorController requires an avatar implementation');
    }
    this.avatar = avatar;
    this.state = null;
    this.random = opts.random || Math.random;
    this._setTimeout = opts.setTimeout || globalThis.setTimeout.bind(globalThis);
    this._clearTimeout = opts.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    this._programTimer = null;
  }

  setState(id, { force = false } = {}) {
    const def = BEHAVIOR_STATES[id];
    if (!def) throw new Error(`unknown behavior state: ${id}`);
    if (!force && this.state === id) return this;
    this._stopProgram();
    this.state = id;
    const program = STATE_PROGRAMS[id];
    if (program) this._startProgram(program);
    else this.avatar.setState(def.renderState);
    return this;
  }

  _startProgram(program) {
    const run = () => {
      if (!this.state || STATE_PROGRAMS[this.state] !== program) return;
      const choices = program.activities;
      const activity = choices[Math.floor(this.random() * choices.length)];
      const def = BEHAVIOR_ACTIVITIES[activity];
      this.avatar.setState(def.renderState);
      const [lo, hi] = program.repeatMs;
      this._programTimer = this._setTimeout(run, lo + this.random() * (hi - lo));
    };
    run();
  }

  _stopProgram() {
    if (this._programTimer !== null) this._clearTimeout(this._programTimer);
    this._programTimer = null;
  }

  destroy() { this._stopProgram(); }

  action(id) {
    const def = BEHAVIOR_ACTIONS[id];
    if (!def) throw new Error(`unknown behavior action: ${id}`);
    this.avatar.action(def.renderAction);
    return this;
  }

  wireAction(id) {
    const behaviorId = WIRE_ACTION_TO_BEHAVIOR[id];
    if (!behaviorId) throw new Error(`unknown wire action: ${id}`);
    return this.action(behaviorId);
  }
}
