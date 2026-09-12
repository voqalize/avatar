/**
 * AvatarClient — the avatar's server-message dispatcher, turn clock, and cue
 * splice, framework-free (no React; the hook and component wrap this).
 *
 * ## Turn clock anchoring
 *
 * Base Pipecat TTS gives each serialized TTS context an opaque `context_id`.
 * The server uses it only to group and splice cue chunks. `botStartedSpeaking`
 * has no context payload, so the browser FIFO-claims the next buffered context
 * at that Pipecat output-lifecycle event. `botStoppedSpeaking` closes it. No
 * avatar-specific speech marker exists.
 *
 * The event says *which* audio is starting, not *when* it is heard, and the
 * turn clock is anchored to the sound itself (`playout.ts` has the
 * measurements that forced it). `attach()` listens to the bot's audio track;
 * at the event, the turn's zero is backdated to a sound that has already begun,
 * or the mouth is held shut until one does. When the track cannot be heard —
 * no `attach()`, no track, a suspended audio graph, or a sound that never
 * arrives within `ONSET_WAIT_MS` — the event is the anchor, as it always was.
 * Which one won is logged once per turn, at `info`, because a desync report is
 * unanswerable without it.
 *
 * The clock then runs `VISUAL_LEAD_MS` ahead of the sound, since the mixer's
 * smoothing makes every mouth shape late by about that much. It is pulled back
 * by any output-device latency beyond what the display already matches (a
 * Bluetooth headset). Within a turn, each resumption after a pause in the
 * track is a second chance to hear where the sound really is — but a mouth
 * opens before its sound, so a resumption heard within the track's usual
 * anticipation of it agrees with the clock. Only a disagreement beyond that is
 * slewed out, at no more than 10 % of clock rate, never jumped, because a
 * mouth that skips is seen and one that runs briefly fast is not.
 *
 * `attach()` subscribes to the avatar server-message channel *and* Pipecat's
 * standard lifecycle events. Server messages carry only what Pipecat cannot:
 * correlated speech/cue timing and deliberate application instructions. The
 * lifecycle events project the factual presence states locally. The server
 * supplies only lower-priority `THINKING` / `WORKING` claims and deliberate,
 * self-completing actions. This keeps the face tied to Pipecat's output truth
 * even if a server claim is delayed or stale.
 *
 * ## Cue splice
 *
 * The widget has two cue-track primitives: `speak({cues, clock})` (a full
 * replace) and `pushCues(cues)` (a pure union that can only grow the track,
 * never shrink it). Neither is "discard queued cues at or after `from_ms`,
 * then append" on its own — `pushCues` has no way to drop a stale tail. So
 * this client keeps the turn's canonical cue array itself (kept portion +
 * every appended chunk, spliced on each `cues` message) and picks the cheapest
 * widget call that stays correct:
 *
 *   - if the splice's `from_ms` doesn't reach back into anything already
 *     queued — the common case past a turn's first sentence, since only the
 *     first sentence genuinely plays fast-leg cues — nothing needs discarding:
 *     `pushCues(newCues)` is the cheap, correct append.
 *   - if it does reach back (a real fast→accurate splice), `pushCues` cannot
 *     express the discard; we call `speak()` again with the full spliced
 *     canonical array on the turn's original clock. `speak()` is otherwise
 *     documented as also killing an in-flight spoken interjection and
 *     re-entering `SPEAKING` — both harmless mid-splice (an interjection
 *     should not be running while a server track owns the mouth; re-entering
 *     an unchanged state is a no-op past the profile/gaze reset the widget
 *     already does for a same-name `setState`).
 *
 * Cues commonly arrive **before** `botStartedSpeaking` — the fast leg starts
 * the moment a sentence is handed to TTS, well before bot output begins.
 * Chunks that arrive before the clock is anchored are spliced into the
 * canonical array but not yet handed to the widget; `botStartedSpeaking` hands over
 * whatever has accumulated as the turn's first `speak()` call. So "the first
 * chunk of a turn starts speak()" means the first *widget* call, not
 * necessarily the first *message*.
 */

import type { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import type { AvatarActionId, AvatarApi } from "../src/avatar.js";
import { BehaviorController } from "../src/behavior.js";
import { createPlayoutProbe, type PlayoutProbe } from "./playout.js";
import {
  isAvatarMessage,
  parseAvatarCommand,
  type AvatarCommand,
  type AvatarCue,
  type AvatarCuesCmd,
} from "./types.js";


interface Turn {
  ctx: string;
  /** The canonical, already-spliced cue track for this turn. */
  cues: AvatarCue[];
  /** Whether Pipecat output has anchored a clock and issued `speak()`. */
  started: boolean;
  clock: (() => number) | null;
  /** Timeline zero on the `now()` clock; `null` while waiting to hear the
   * audio begin, during which the clock reads before the first cue. */
  t0: number | null;
  /** Where a re-anchor has placed zero; `t0` slews toward it. */
  target: number | null;
  /** `now()` at the clock's last read, which bounds how far a slew may move. */
  read: number;
  /** How far the clock runs ahead of the sound, fixed for the turn. */
  lead: number;
  /** The last resumption (track ms) already listened for. */
  checked: number;
}

/**
 * Longest the mouth is held for audio `botStartedSpeaking` has announced but
 * the track has not yet carried. The event has been measured leading the first
 * sample by ~160 ms on a local stack; twice that is a stall, and a mouth that
 * starts without its sound is better than one that waits indefinitely.
 */
const ONSET_WAIT_MS = 350;
const ONSET_POLL_MS = 10;

/**
 * How far the cue clock runs ahead of the sound. The mixer eases every mouth
 * channel toward its target with a 42 ms time constant
 * (`MOUTH_RESPONSE_TAU_S`), which delays a shape by about that much, and a
 * frame is drawn on average half a frame after its time. Picture ahead of sound
 * is the side people forgive (ITU-R BT.1359: sound leading is noticed at about
 * 45 ms, picture leading at about 125 ms), so a small surplus is the safe error.
 */
export const VISUAL_LEAD_MS = 50;
/** Output latency the display already matches: a compositor and a screen are
 * late by about as much as a wired speaker, so only the excess counts. */
const DISPLAY_LATENCY_MS = 40;
/** A reported latency beyond this is a broken report, not a device. */
const MAX_OUTPUT_LATENCY_MS = 250;
/** A pause in the track at least this long is one the audio can be heard to
 * resume after — shorter ones are usually not digital silence on the wire. */
const REANCHOR_GAP_MS = 250;
/** When to look, after the resumption is due, and for how long. The probe
 * sees 170 ms back, so one look catches an early sound as well as a late one. */
const REANCHOR_LOOK_MS = 100;
const REANCHOR_WINDOW_MS = 150;
/**
 * Where a resumption is heard, after the cue that marks it. The track opens
 * the mouth before the sound leaves digital silence: by 30–41 ms at most of the
 * demo corpus's silent resumptions (median 32, both voices) and by up to 105 at
 * a few, and the browser hears the sound a few ms after it leaves the wire. A
 * sound heard anywhere in that band is the clock being right. Taking
 * it as the resumption itself set every later phrase of a turn that much late —
 * the direction people notice — and a mouth left early by an underrun smaller
 * than the band is the direction they forgive (see `VISUAL_LEAD_MS`).
 */
const RESUME_HEARD_MS = 30;
const RESUME_HEARD_RANGE_MS = [0, 130] as const;
/** The most a re-anchor may speed or slow the clock, as a fraction of real time. */
const MAX_SLEW = 0.1;

/**
 * Internal. Not exported from the package — the public surface is
 * `createAvatar({ mount, client })` and nothing else.
 *
 * There is deliberately no `accept` predicate here any more. Avatar commands
 * travel in one envelope, `{type:"avatar"}`, in both directions and from every
 * source: a `AvatarProcessor` in the pipeline and a brain driving the face
 * out of band emit the same shape. A per-deployment predicate meant the
 * library could not state what an avatar message *is*, which is the one thing
 * a wire format has to be able to say.
 */
export interface AvatarClientOptions {
  /** A dispatch threw (e.g. an unknown state or interjection id, which the
   * widget throws on). Defaults to `console.warn`. */
  onError?: (err: unknown, msg: AvatarCommand) => void;
  /** Override for tests. Defaults to `performance.now`. */
  now?: () => number;
  /** Override for tests. Defaults to listening to the bot's audio track, once
   * `attach()` has found one. */
  playoutProbe?: PlayoutProbe;
  /** Quiet time in listening before the client-owned idle loop begins. */
  idleDelayMs?: number;
  /** Timer seams keep lifecycle behavior deterministic in tests. */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  /**
   * Internal, for Studio's inspector — the resolved projection, so a developer
   * tool can show what the lifecycle decided. It is *not* on the public
   * surface and must not become one: a presence callback is a contract, and
   * publishing it would oblige every avatar implementation to emit these seven
   * states with this precedence, which is exactly the second public contract
   * the design exists to avoid.
   */
  onPresenceChange?: (state: AvatarPresenceState) => void;
}

/**
 * The one `RTVIEvent` member `attach()` subscribes to, spelled as its value.
 *
 * Written out rather than imported because that enum was this module's *only*
 * runtime reference to `@pipecat-ai/client-js`, and one runtime reference makes
 * the whole `/pipecat` subpath fail to load without the peer installed — even
 * for a host that drives `dispatch()` from its own transport and never calls
 * `attach()`. The peer is declared optional; this is what makes that true
 * rather than aspirational.
 *
 * String enums are nominal in TypeScript, so the compiler cannot check these
 * against the real ones from a type-only import. `packages/avatar/test/AvatarClient.test.ts`
 * does it instead, against the actual enum — the devDependency is present
 * exactly where the check belongs and absent from what we ship.
 */
export const RTVI_EVENTS = {
  serverMessage: "serverMessage",
  connected: "connected",
  disconnected: "disconnected",
  botReady: "botReady",
  error: "error",
  userStartedSpeaking: "userStartedSpeaking",
  userStoppedSpeaking: "userStoppedSpeaking",
  botStartedSpeaking: "botStartedSpeaking",
  botStoppedSpeaking: "botStoppedSpeaking",
  // Only to find the bot's audio track once the transport has it; which track
  // is re-read from `tracks()`, the one authority for whose it is.
  trackStarted: "trackStarted",
  // Mute is a Pipecat fact, not a claim: the server's mute strategy emits
  // `UserMuteStarted/StoppedFrame`, the RTVI observer forwards them, and the
  // browser client raises these. So "has muted you" costs no wire verb —
  // reading the events the peer already sends is exactly the authority model.
  userMuteStarted: "userMuteStarted",
  userMuteStopped: "userMuteStopped",
} as const satisfies Record<string, string>;

/** The resolved, factual presence state a host may render around the avatar. */
export type AvatarPresenceState =
  | "IDLE" | "LISTENING" | "STRAINING" | "THINKING" | "WORKING"
  | "MUTED" | "SPEAKING" | "DEGRADED" | "OFFLINE";
type LifecycleState = AvatarPresenceState;
type ServerClaim = "STRAINING" | "THINKING" | "WORKING" | null;

/** Defensive unwrap for the `RTVIEvent.ServerMessage` `{ data }` quirk: some
 * transports deliver the payload directly and some wrap it once more. */
function unwrapServerMessage(raw: unknown): Record<string, unknown> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const inner = obj["data"] as Record<string, unknown> | undefined;
  return inner && "type" in inner ? inner : obj;
}

export class AvatarClient {
  private readonly avatar: AvatarApi;
  /** Maps factual/wire intent into the broader client behavior catalog. */
  private readonly behavior: BehaviorController;
  private readonly opts: AvatarClientOptions;
  private readonly now: () => number;
  private turn: Turn | null = null;
  private readonly turns = new Map<string, Turn>();
  private readonly pendingCtxs: string[] = [];
  private readonly closedCtxs = new Set<string>();
  private projected: LifecycleState | null = null;
  private serverClaim: ServerClaim = null;
  private userSpeaking = false;
  private botSpeaking = false;
  private muted = false;
  private listening = false;
  // Idle is earned after a connected, quiet listening interval. A newly
  // mounted avatar is available, not already "stepped aside".
  private idle = false;
  private failure: "DEGRADED" | "OFFLINE" | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInterruptedAction = false;
  private discardQueuedContextsOnBotStop = false;
  private readonly idleDelayMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private probe: PlayoutProbe | null;
  private probeTrack: MediaStreamTrack | null = null;
  /** Whether the probe has ever heard an onset. One that has not, and times
   * out, is deaf to this track rather than early to it. */
  private probeHeard = false;
  private onsetTimer: ReturnType<typeof setTimeout> | null = null;
  private reanchorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(avatar: AvatarApi, opts: AvatarClientOptions = {}) {
    this.avatar = avatar;
    this.behavior = new BehaviorController(avatar);
    this.opts = opts;
    this.now = opts.now ?? (() => performance.now());
    this.idleDelayMs = opts.idleDelayMs ?? 12_000;
    this.setTimer = opts.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimer = opts.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    this.probe = opts.playoutProbe ?? null;
  }

  /** The active turn's ctx, or `null` between turns. For tests and telemetry. */
  get turnCtx(): string | null {
    return this.turn?.ctx ?? null;
  }

  /** The active turn's canonical (already-spliced) cue track. For tests and telemetry. */
  get turnCues(): AvatarCue[] {
    return this.turn ? [...this.turn.cues] : [];
  }

  /** Current resolved projection. Internal — for tests and Studio's inspector.
   * Before the first lifecycle fact the renderer is simply at its ready rest
   * pose, so `LISTENING` is the safe value; it is not a session status. */
  get presenceState(): AvatarPresenceState {
    return this.projected ?? "LISTENING";
  }

  /** Re-apply the currently resolved factual projection after an embedding
   * tool has temporarily used raw renderer controls. This does not invent a
   * lifecycle event or cancel a finite action. */
  restoreProjection(): void {
    this.applyProjection(true);
  }

  /** Dispatch one server message. Anything that isn't in the avatar envelope
   * is not ours and is ignored; so is an envelope carrying a `cmd` this build
   * has never heard of, per the wire protocol's forward-compat rule. */
  dispatch(raw: unknown): void {
    if (!isAvatarMessage(raw)) return;
    const msg = parseAvatarCommand(raw);
    if (!msg) return;
    try {
      switch (msg.cmd) {
        case "claim":
          this.handleClaim(msg.state);
          break;
        case "action":
          this.handleAction(msg.id);
          break;
        case "cues":
          this.handleCues(msg);
          break;
        // No default: an unknown `cmd` is a newer server talking to an older
        // widget, and the protocol's forward-compat rule says ignore it. There
        // is no callback for it — a hook nobody could act on is observability,
        // not an interface.
      }
    } catch (err) {
      if (this.opts.onError) this.opts.onError(err, msg);
      else console.warn("[avatar] dispatch failed", msg, err);
    }
  }

  private handleClaim(state: ServerClaim): void {
    this.serverClaim = state;
    if (state) this.idle = false;
    this.applyProjection();
    this.armIdleIfEligible();
  }

  private handleAction(id: AvatarActionId): void {
    // An interruption is a server-confirmed explanation of a transition, not
    // authority to steal the mouth while bot audio is still playing. Hold it
    // until Pipecat output has released the speaking state.
    if (id === "RESPONSE_INTERRUPTED" && this.botSpeaking) {
      this.pendingInterruptedAction = true;
      // Any prefetched TTS contexts behind interrupted output belong to
      // audio Pipecat will now discard. Never let one animate a later reply.
      this.discardQueuedContextsOnBotStop = true;
      return;
    }
    this.playAction(id);
  }

  private playAction(id: AvatarActionId): void {
    this.behavior.wireAction(id);
  }

  private ensureTurn(ctx: string): Turn {
    const existing = this.turns.get(ctx);
    if (existing) return existing;
    const turn: Turn = {
      ctx, cues: [], started: false, clock: null, t0: null,
      target: null, read: 0, lead: 0, checked: -Infinity,
    };
    this.turns.set(ctx, turn);
    this.pendingCtxs.push(ctx);
    return turn;
  }

  private handleCues(msg: AvatarCuesCmd) {
    if (this.closedCtxs.has(msg.ctx)) return;
    const turn = this.ensureTurn(msg.ctx);
    const kept = turn.cues.filter((c) => c.t < msg.from_ms);
    const discarded = turn.cues.length - kept.length;
    turn.cues = [...kept, ...msg.cues].sort((a, b) => a.t - b.t);

    if (!turn.started) {
      // No clock yet — buffer. Pipecat output will claim this FIFO context.
      if (this.botSpeaking && this.turn === null) this.activateNextTurn();
      return;
    }
    if (discarded === 0) {
      this.avatar.pushCues(msg.cues);
    } else {
      this.avatar.speak({ cues: turn.cues, clock: turn.clock! });
    }
    // A resumption this chunk added may be the next one worth listening for.
    this.scheduleReanchor(turn);
  }

  private activateNextTurn(): void {
    if (this.turn) return;
    let turn: Turn | undefined;
    while (this.pendingCtxs.length && !turn) {
      turn = this.turns.get(this.pendingCtxs.shift()!);
    }
    if (!turn) return;
    const active = turn;
    active.lead = this.leadMs();
    active.clock = () => {
      if (active.t0 === null) return -1;
      const now = this.now();
      if (active.target !== null) {
        const room = MAX_SLEW * Math.max(0, now - active.read);
        const off = active.target - active.t0;
        if (Math.abs(off) <= room) {
          active.t0 = active.target;
          active.target = null;
        } else {
          active.t0 += Math.sign(off) * room;
        }
      }
      active.read = now;
      return now - active.t0 + active.lead;
    };
    active.started = true;
    this.turn = active;
    this.anchor(active);
    this.avatar.speak({ cues: active.cues, clock: active.clock });
  }

  /** Put the turn's zero where its sound began — see the header. */
  private anchor(turn: Turn): void {
    const event = this.now();
    // A context made before any gesture can sit suspended; every turn asks again.
    this.probe?.resume?.();
    const heard = this.probe?.onset();
    if (typeof heard === "number") {
      this.probeHeard = true;
      this.anchored(turn, heard, "the sound", event);
      return;
    }
    if (heard !== null) {
      this.anchored(turn, event, this.probe ? "the event (probe cannot say)" : "the event (no probe)", event);
      return;
    }
    const poll = () => {
      this.onsetTimer = null;
      if (this.turn !== turn) return;
      const onset = this.probe?.onset();
      if (typeof onset === "number") {
        this.probeHeard = true;
        this.anchored(turn, onset, "the sound", event);
      } else if (onset === null && this.now() - event < ONSET_WAIT_MS) {
        this.onsetTimer = this.setTimer(poll, ONSET_POLL_MS);
      } else {
        if (!this.probeHeard) this.dropProbe();
        this.anchored(turn, event, onset === null ? "the event (no sound in time)" : "the event (probe cannot say)", event);
      }
    };
    this.onsetTimer = this.setTimer(poll, ONSET_POLL_MS);
  }

  private anchored(turn: Turn, t0: number, how: string, event: number): void {
    turn.t0 = t0;
    turn.read = this.now();
    console.info(
      `[avatar] ${turn.ctx} anchored on ${how}: sound ${Math.round(event - t0)} ms before the event, `
        + `mouth ${Math.round(turn.lead)} ms ahead`,
    );
    this.scheduleReanchor(turn);
  }

  /** The lead for a turn starting now — see `VISUAL_LEAD_MS`. */
  private leadMs(): number {
    const out = this.probe?.outputLatencyMs?.() ?? 0;
    const excess = Math.min(MAX_OUTPUT_LATENCY_MS, Math.max(0, out - DISPLAY_LATENCY_MS));
    return VISUAL_LEAD_MS - excess;
  }

  /** The first resumption after `after` (track ms) that follows a pause long
   * enough to be heard as one. */
  private nextResumption(turn: Turn, after: number): number | null {
    let silentFrom: number | null = null;
    for (const c of turn.cues) {
      if (c.v === "X") {
        silentFrom ??= c.t;
        continue;
      }
      if (silentFrom !== null && c.t - silentFrom >= REANCHOR_GAP_MS && c.t > after) return c.t;
      silentFrom = null;
    }
    return null;
  }

  /** Listen for the sound at the turn's next resumption, once. */
  private scheduleReanchor(turn: Turn): void {
    if (this.reanchorTimer !== null || !this.probe || turn.t0 === null || this.turn !== turn) return;
    const zero = turn.target ?? turn.t0;
    const at = this.nextResumption(turn, Math.max(turn.checked, this.now() - zero - REANCHOR_WINDOW_MS));
    if (at === null) return;
    const poll = () => {
      this.reanchorTimer = null;
      if (this.turn !== turn || !this.probe || turn.t0 === null) return;
      const due = (turn.target ?? turn.t0) + at;
      const onset = this.probe.onset();
      if (onset === null && this.now() < due + RESUME_HEARD_MS + REANCHOR_WINDOW_MS) {
        this.reanchorTimer = this.setTimer(poll, ONSET_POLL_MS);
        return;
      }
      turn.checked = at;
      // `undefined` is sound all the way back: the pause was not silence on
      // the wire, or it resumed long before the track says. Either way there
      // is nothing to measure.
      if (typeof onset === "number") {
        const heard = onset - due;
        const [earliest, latest] = RESUME_HEARD_RANGE_MS;
        const agrees = heard >= earliest && heard <= latest;
        if (!agrees && Math.abs(heard - RESUME_HEARD_MS) <= REANCHOR_WINDOW_MS) {
          turn.target = onset - at - RESUME_HEARD_MS;
        }
      }
      this.scheduleReanchor(turn);
    };
    const zeroNow = turn.target ?? turn.t0;
    this.reanchorTimer = this.setTimer(poll, Math.max(0, zeroNow + at + REANCHOR_LOOK_MS - this.now()));
  }

  private clearReanchorTimer(): void {
    if (this.reanchorTimer !== null) {
      this.clearTimer(this.reanchorTimer);
      this.reanchorTimer = null;
    }
  }

  private clearOnsetTimer(): void {
    if (this.onsetTimer !== null) {
      this.clearTimer(this.onsetTimer);
      this.onsetTimer = null;
    }
  }

  private dropProbe(): void {
    this.probe?.dispose();
    this.probe = null;
    this.probeTrack = null;
    this.probeHeard = false;
  }

  /** Listen to the bot's audio track, if the transport has one yet. */
  private listenTo(client: PipecatClient, heard?: MediaStreamTrack): void {
    if (this.opts.playoutProbe) return;
    let track: MediaStreamTrack | undefined = heard;
    if (!track) {
      try {
        track = client.tracks().bot?.audio;
      } catch {
        return;
      }
    }
    if (!track || track === this.probeTrack) return;
    this.dropProbe();
    this.probe = createPlayoutProbe(track, this.now);
    this.probeTrack = this.probe ? track : null;
  }

  private discardQueuedTurns(): void {
    for (const ctx of this.pendingCtxs.splice(0)) {
      this.closedCtxs.add(ctx);
      this.turns.delete(ctx);
    }
  }

  private lifecycleState(): LifecycleState {
    // The one copy of the ladder is docs/pipecat-lifecycle-protocol.md; this is
    // its implementation, in the same order.
    //
    // Audio truth is the P0 invariant: no lower claim or microphone event may
    // put the face in a non-speaking pose while bot speech is audible.
    if (this.botSpeaking) return "SPEAKING";
    if (this.userSpeaking) return "LISTENING";
    // A broken session outranks mute, because a mute nobody can hear about is
    // not the thing worth saying about a dead call.
    if (this.failure) return this.failure;
    if (this.muted) return "MUTED";
    // Every claim resolves to the presence state of the same name, so there is
    // nothing to rank here — a claim is a single value and only one can be in
    // flight. STRAINING > THINKING > WORKING is decided where more than one
    // condition can hold at once, which is the server: `AvatarStateMachine.
    // _resolve()`. Ranking them again on this side would be a second, silent
    // copy of that ladder, and the two would drift.
    if (this.serverClaim) return this.serverClaim;
    if (this.idle) return "IDLE";
    return "LISTENING";
  }

  private applyProjection(force = false): void {
    const state = this.lifecycleState();
    if (force || this.projected !== state) {
      this.behavior.setState(state);
      this.projected = state;
      this.opts.onPresenceChange?.(state);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private armIdleIfEligible(): void {
    this.clearIdleTimer();
    // Quiet under a mute is not the quiet that earns IDLE — the silence was
    // imposed, and letting the timer run behind it would reveal a stepped-aside
    // face the moment the microphone came back.
    if (!this.eligibleForIdle()) return;
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null;
      if (this.eligibleForIdle()) {
        this.idle = true;
        this.applyProjection();
      }
    }, this.idleDelayMs);
  }

  private eligibleForIdle(): boolean {
    return this.listening && !this.userSpeaking && !this.botSpeaking
      && !this.muted && !this.serverClaim && !this.failure;
  }

  private enterListening(): void {
    this.listening = true;
    this.idle = false;
    this.applyProjection();
    this.armIdleIfEligible();
  }

  private clearClaimForTurnBoundary(): void {
    // Claims are lower-priority hints. A fresh user turn or bot output means
    // any prior thinking/work claim is no longer allowed to reappear later.
    this.serverClaim = null;
  }

  private maybePlayInterrupted(): void {
    if (this.pendingInterruptedAction && !this.botSpeaking) {
      this.pendingInterruptedAction = false;
      this.playAction("RESPONSE_INTERRUPTED");
    }
  }

  private clearRecoverableFailure(): void {
    if (this.failure === "DEGRADED") {
      this.failure = null;
      this.applyProjection();
    }
  }

  private onUserStartedSpeaking = (): void => {
    this.clearRecoverableFailure();
    this.userSpeaking = true;
    this.clearClaimForTurnBoundary();
    this.listening = true;
    this.idle = false;
    this.clearIdleTimer();
    this.avatar.setUserSpeaking(true);
    this.applyProjection();
  };

  private onUserStoppedSpeaking = (): void => {
    this.userSpeaking = false;
    this.avatar.setUserSpeaking(false);
    this.enterListening();
  };

  private onBotStartedSpeaking = (): void => {
    this.clearRecoverableFailure();
    this.botSpeaking = true;
    this.clearClaimForTurnBoundary();
    this.idle = false;
    this.clearIdleTimer();
    this.applyProjection();
    this.activateNextTurn();
  };

  private onBotStoppedSpeaking = (): void => {
    this.botSpeaking = false;
    this.clearOnsetTimer();
    this.clearReanchorTimer();
    // Playout truth releases the only active mouth track. A late cue chunk for
    // this context is ignored rather than reviving a silent mouth.
    if (this.turn) {
      this.avatar.stopSpeaking();
      this.closedCtxs.add(this.turn.ctx);
      this.turns.delete(this.turn.ctx);
      this.turn = null;
    }
    if (this.discardQueuedContextsOnBotStop) {
      this.discardQueuedContextsOnBotStop = false;
      this.discardQueuedTurns();
    }
    this.enterListening();
    this.maybePlayInterrupted();
  };

  private onUserMuteStarted = (): void => {
    this.muted = true;
    this.idle = false;
    this.clearIdleTimer();
    this.applyProjection();
  };

  private onUserMuteStopped = (): void => {
    this.muted = false;
    // Whatever the avatar was waiting on before the mute, it is waiting on the
    // user again now — the same place a turn ends.
    this.enterListening();
  };

  private onError = (raw: unknown): void => {
    const data = (raw as { data?: unknown })?.data as { fatal?: unknown } | undefined;
    this.failure = data?.fatal === true ? "OFFLINE" : "DEGRADED";
    this.applyProjection();
  };

  private onDisconnected = (): void => {
    this.failure = "OFFLINE";
    this.clearIdleTimer();
    this.applyProjection();
  };

  private onConnectedOrReady = (): void => {
    if (this.failure === "OFFLINE") this.failure = null;
    // Pipecat has established a session. Until a factual speech event says
    // otherwise, the avatar is available to listen; it earns IDLE only after
    // the regular quiet timer expires.
    this.listening = true;
    this.idle = false;
    this.applyProjection();
    this.armIdleIfEligible();
  };

  /**
   * Subscribe to a live `PipecatClient`. Standard client events own the normal
   * lifecycle projection; avatar server-messages carry correlated visemes and
   * explicit application intent. Never throws on malformed or irrelevant
   * server messages.
   *
   * @returns an unsubscribe function; call it on unmount or disconnect.
   */
  attach(client: PipecatClient): () => void {
    const onServerMessage = (raw: unknown) => this.dispatch(unwrapServerMessage(raw));
    // The bot's track has to come from the event. SmallWebRTC never lists a
    // remote track in `tracks()`; it only hands it to this callback, with no
    // participant. Asking `tracks()` alone meant no probe on that transport,
    // so every turn fell back to the event.
    const onTrackStarted = (track?: MediaStreamTrack, participant?: { local?: boolean }) => {
      if (participant?.local || (track && track.kind !== "audio")) return;
      this.listenTo(client, track);
    };
    const subscriptions: Array<[string, (...args: any[]) => void]> = [
      [RTVI_EVENTS.serverMessage, onServerMessage],
      [RTVI_EVENTS.connected, this.onConnectedOrReady],
      [RTVI_EVENTS.botReady, this.onConnectedOrReady],
      [RTVI_EVENTS.disconnected, this.onDisconnected],
      [RTVI_EVENTS.error, this.onError],
      [RTVI_EVENTS.userStartedSpeaking, this.onUserStartedSpeaking],
      [RTVI_EVENTS.userStoppedSpeaking, this.onUserStoppedSpeaking],
      [RTVI_EVENTS.botStartedSpeaking, this.onBotStartedSpeaking],
      [RTVI_EVENTS.botStoppedSpeaking, this.onBotStoppedSpeaking],
      [RTVI_EVENTS.userMuteStarted, this.onUserMuteStarted],
      [RTVI_EVENTS.userMuteStopped, this.onUserMuteStopped],
      [RTVI_EVENTS.trackStarted, onTrackStarted],
    ];
    for (const [event, listener] of subscriptions) client.on(event as RTVIEvent, listener as never);
    this.listenTo(client);
    // Some browsers keep an audio context suspended until it is resumed inside
    // a gesture, and the connect click usually lands before the bot's track
    // exists. Any later click or key is the next chance.
    const wake = () => this.probe?.resume?.();
    const doc = typeof document === "undefined" ? null : document;
    doc?.addEventListener("pointerdown", wake, true);
    doc?.addEventListener("keydown", wake, true);
    return () => {
      doc?.removeEventListener("pointerdown", wake, true);
      doc?.removeEventListener("keydown", wake, true);
      this.clearIdleTimer();
      this.clearOnsetTimer();
      this.clearReanchorTimer();
      if (!this.opts.playoutProbe) this.dropProbe();
      for (const [event, listener] of subscriptions) client.off(event as RTVIEvent, listener as never);
    };
  }

  /** Dispose controller-owned timers when its mounted avatar is destroyed. */
  destroy(): void {
    this.clearIdleTimer();
    this.clearOnsetTimer();
    this.clearReanchorTimer();
    this.dropProbe();
    this.behavior.destroy();
  }
}
