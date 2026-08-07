/**
 * Perform — the composable action timeline.
 *
 * A performance is the server's choreography: timed verbs `{t, do, ...}` fired
 * against a clock, where every verb resolves to one of the widget's own enums —
 * states, emotions, gaze targets, interjections, hand gestures. The vocabulary is deliberately
 * closed: the backend sequences what the rig already does well, it cannot
 * invent motion. That constraint is what makes the wire format assemblable by
 * a dialogue manager and reviewable by a human.
 *
 * The clock discipline is VisemeTrack's (visemes.js): ride the audio clock
 * whenever there is audio, because a gesture that drifts out of its own
 * sentence is worse than no gesture at all, and a timer drifts the moment the
 * tab is backgrounded. One deliberate difference: beat times fire *verbatim*,
 * with no LEAD_MS. Visemes lead the sound because phoneme sync is
 * frame-critical; a gesture arrives through its channels' own smoothing lag,
 * and any deliberate lead (CLAIM_FLOOR starts ~350ms before the first sample)
 * is authored into the times by the composer, not imposed here.
 *
 * Seeking the audio backward does not re-fire earlier actions: verbs have side
 * effects, and replaying a nod is worse than missing one.
 */

const VERBS = new Set(['state', 'emotion', 'gaze', 'interject', 'gesture']);
// The verbs addressed by `id` rather than `name`. Both id verbs name a clip the
// widget already owns; both name-verbs name an enum value.
const ID_VERBS = new Set(['interject', 'gesture']);

/**
 * Shape hygiene for action arrays, in the spirit of normalizeCues: sort by
 * time, drop what cannot possibly fire — no finite `t`, an unknown verb, a
 * missing `name`/`id` — each with a console warning, never a throw.
 *
 * This checks *shape* only. Enum values (is "THINKING" a state? is "NOD_UP"
 * an interjection?) are checked when the verb fires, by the dispatcher in
 * avatar.js — deliberately, and not just because importing the enums here
 * would be a dependency cycle: a track half-composed against a newer widget
 * should lose the verbs the widget doesn't know, not the whole performance.
 */
export function normalizeActions(actions) {
  const out = [];
  for (const a of actions || []) {
    if (!a || typeof a.t !== 'number' || !Number.isFinite(a.t)) {
      console.warn('perform: dropped action without a time', a);
      continue;
    }
    if (!VERBS.has(a.do)) {
      console.warn(`perform: dropped unknown verb "${a && a.do}"`, a);
      continue;
    }
    const idVerb = ID_VERBS.has(a.do);
    if ((idVerb ? a.id : a.name) == null) {
      console.warn(`perform: dropped ${a.do} with no ${idVerb ? 'id' : 'name'}`, a);
      continue;
    }
    out.push(a);
  }
  return out.sort((x, y) => x.t - y.t);
}

/**
 * Schedules an action track against a clock. Sampled by the mixer once per
 * frame, so firing granularity is one frame — gestures cannot tell.
 */
export class PerformTrack {
  constructor() {
    this.actions = [];
    this.clock = null;
    this.playing = false;
    this._idx = 0;
    /** @type {(a: object) => void} fired per action, in time order */
    this.onAction = null;
    /** Fired when the last action has fired — not when its effects finish. */
    this.onEnd = null;
  }

  /** @param {() => number} clock elapsed ms of whatever the track rides on */
  start(actions, clock) {
    this.actions = normalizeActions(actions);
    this.clock = clock;
    this._idx = 0;
    this.playing = true;
    if (!this.actions.length) this._finish();
  }

  /** Cancels future actions. Does not fire onEnd: a stopped performance did
   *  not complete, and nothing downstream should be told it did. */
  stop() {
    this.playing = false;
    this.actions = [];
    this.clock = null;
    this._idx = 0;
  }

  update() {
    if (!this.playing || !this.clock) return;
    const now = this.clock();
    while (this._idx < this.actions.length && this.actions[this._idx].t <= now) {
      const a = this.actions[this._idx++];
      if (this.onAction) this.onAction(a);
    }
    if (this._idx >= this.actions.length) this._finish();
  }

  _finish() {
    this.playing = false;
    if (this.onEnd) this.onEnd();
  }
}
