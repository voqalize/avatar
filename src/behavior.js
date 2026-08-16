/**
 * Behavior catalog and controller.
 *
 * This is the layer between factual/wire inputs and the bundled SVG renderer.
 * It is not a seam any avatar implementation sees: an implementation receives
 * a PipecatClient and decides for itself what a state means.
 *
 * The vocabulary is the nine core states. It used to be seventeen — the core
 * set plus every SVG render state (TYPING, CANT_HEAR, SEARCHING_SCREEN, …)
 * passed straight through, so that tooling could drive one of *those* from
 * here. That made the mixer's private state list look like part of the
 * behaviour vocabulary. Tooling that wants a render state calls
 * `avatar.setState` on the mixer, which is whose state it is.
 */

/**
 * Durable states the behavior layer resolves, and the render state each one
 * asks the bundled SVG mixer for. The right-hand column belongs to a renderer:
 * `WORKING` may draw as anything, and this is where a divergence lands rather
 * than leaks. `STRAINING` is the first row to actually use that — the two
 * columns were written out for years while the mapping stayed 1:1.
 */
export const BEHAVIOR_STATES = Object.freeze({
  IDLE: { renderState: 'IDLE' },
  LISTENING: { renderState: 'LISTENING' },
  // What the server calls straining, this renderer draws as CANT_HEAR: the
  // behavior name claims only that the avatar is trying harder to hear, while
  // the pose is one particular drawing of that. A renderer with no such pose
  // may legitimately point this at LISTENING.
  STRAINING: { renderState: 'CANT_HEAR' },
  THINKING: { renderState: 'THINKING' },
  WORKING: { renderState: 'WORKING' },
  MUTED: { renderState: 'MUTED' },
  SPEAKING: { renderState: 'SPEAKING' },
  DEGRADED: { renderState: 'DEGRADED' },
  OFFLINE: { renderState: 'OFFLINE' },
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
  constructor(avatar) {
    if (!avatar || typeof avatar.setState !== 'function' || typeof avatar.action !== 'function') {
      throw new TypeError('BehaviorController requires an avatar implementation');
    }
    this.avatar = avatar;
    this.state = null;
  }

  setState(id, { force = false } = {}) {
    const def = BEHAVIOR_STATES[id];
    if (!def) throw new Error(`unknown behavior state: ${id}`);
    if (!force && this.state === id) return this;
    this.state = id;
    this.avatar.setState(def.renderState);
    return this;
  }

  destroy() {}

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
