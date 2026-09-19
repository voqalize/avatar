/**
 * Behavior catalog and controller.
 *
 * This is the layer between factual/wire inputs and the bundled SVG renderer.
 * It is not a seam any avatar implementation sees: an implementation receives
 * a PipecatClient and decides for itself what a state means.
 *
 * The vocabulary is the nine core states and two core actions. The states used
 * to be seventeen — the core
 * set plus every SVG render state (TYPING, SEARCHING_SCREEN, WANTS_IN, …)
 * passed straight through, so that tooling could drive one of *those* from
 * here. That made the mixer's private state list look like part of the
 * behaviour vocabulary. Tooling that wants a render state calls
 * `avatar.setState` on the mixer, which is whose state it is.
 */

/**
 * The durable states this layer resolves. Each one *is* the render state it
 * asks the bundled SVG mixer for, so there is nothing here to map.
 *
 * There used to be a second column — a per-state `renderState`, so a renderer
 * could draw `WORKING` as anything it liked and the divergence would land here
 * rather than leak. In nine rows it had exactly one non-identity entry,
 * `STRAINING -> CANT_HEAR`, and the wire redesign deleted that entry by
 * renaming the state: a state names the bot's *situation*, never how it looks,
 * and "straining" was a situation named after one drawing of it. A table whose
 * every row reads `X: X` documents nothing and invites a renderer to plug into
 * it, so it is a list now. A renderer that genuinely wants to draw one of these
 * as something else calls `avatar.setState` with the render state it wants,
 * which is whose state that is.
 */
export const BEHAVIOR_STATE_IDS = Object.freeze([
  'IDLE', 'LISTENING', 'CANT_HEAR', 'THINKING', 'WORKING',
  'MUTED', 'SPEAKING', 'DEGRADED', 'OFFLINE',
]);

const STATE_IDS = new Set(BEHAVIOR_STATE_IDS);

/**
 * Library action IDs: the two intents every renderer owes a server, in this
 * layer's readable spelling.
 *
 * It used to be seven, with a `sequence` command alongside for a renderer's own
 * motions. The seven were not the wrong *names* so much as the wrong idea: four
 * of them were `GESTURE_*` — a greet, a goodbye, a wave — which are things a
 * particular body does and not intents a server can hold every face to, and two
 * were the receipt and the nod, which are two *shapes* of acknowledging. So the
 * server now says only that an acknowledgement is due, the avatar picks which
 * one it makes, and the gestures live in whichever catalogue can draw them,
 * reachable by the same open `action` id a sequence used to need its own
 * command for.
 */
export const BEHAVIOR_ACTIONS = Object.freeze({
  ack: { renderAction: 'ACKNOWLEDGE' },
  'turn.interrupted': { renderAction: 'RESPONSE_INTERRUPTED' },
});

export const BEHAVIOR_ACTION_IDS = Object.freeze(Object.keys(BEHAVIOR_ACTIONS));

/** The two core wire names map into the behavior catalog here and nowhere else. */
export const WIRE_ACTION_TO_BEHAVIOR = Object.freeze({
  ACKNOWLEDGE: 'ack',
  RESPONSE_INTERRUPTED: 'turn.interrupted',
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
    if (!STATE_IDS.has(id)) throw new Error(`unknown behavior state: ${id}`);
    if (!force && this.state === id) return this;
    this.state = id;
    this.avatar.setState(id);
    return this;
  }

  destroy() {}

  action(id) {
    const def = BEHAVIOR_ACTIONS[id];
    if (!def) throw new Error(`unknown behavior action: ${id}`);
    this.avatar.action(def.renderAction);
    return this;
  }

  /**
   * One id off the wire. A core one goes through the behavior catalog; any
   * other goes straight to the renderer, and that asymmetry is the point.
   * `BEHAVIOR_ACTIONS` exists so a portable intent has a readable name
   * independent of how any one face renders it. An avatar's own id has no such
   * independence — it *is* the rendering, named by the renderer that owns it —
   * so giving it a behavior alias would claim a portability it does not have.
   *
   * Neither path throws. The wire's action vocabulary is open and an id this
   * face cannot draw is the expected case, not somebody's broken build.
   */
  wireAction(id) {
    const behaviorId = WIRE_ACTION_TO_BEHAVIOR[id];
    if (behaviorId) return this.action(behaviorId);
    this.avatar.action(id);
    return this;
  }
}
