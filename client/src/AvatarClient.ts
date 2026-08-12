/**
 * AvatarClient — the avatar's server-message dispatcher, turn clock, and cue
 * splice, framework-free (no React; the hook and component wrap this).
 *
 * ## Turn clock anchoring
 *
 * Base Pipecat TTS gives each serialized TTS context an opaque `context_id`.
 * The server uses it only to group and splice cue chunks. `botStartedSpeaking`
 * has no context payload, so the browser FIFO-claims the next buffered context
 * at that factual playout event and anchors its clock there. `botStoppedSpeaking`
 * closes the active context. No avatar-specific speech marker exists.
 *
 * `attach()` subscribes to the avatar server-message channel *and* Pipecat's
 * standard lifecycle events. Server messages carry only what Pipecat cannot:
 * correlated speech/cue timing and deliberate application instructions. The
 * lifecycle events project the factual presence states locally. The server
 * supplies only lower-priority `THINKING` / `WORKING` claims and deliberate,
 * self-completing actions. This keeps the face tied to playout truth even if a
 * server claim is delayed or stale.
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
 * the moment a sentence is handed to TTS, well before audio playout.
 * Chunks that arrive before the clock is anchored are spliced into the
 * canonical array but not yet handed to the widget; `botStartedSpeaking` hands over
 * whatever has accumulated as the turn's first `speak()` call. So "the first
 * chunk of a turn starts speak()" means the first *widget* call, not
 * necessarily the first *message*.
 */

import type { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import type { AvatarApi } from "../../src/avatar.js";
import {
  isAvatarMessage,
  type AvatarCommand,
  type AvatarCue,
  type AvatarCuesCmd,
} from "./types.js";


interface Turn {
  ctx: string;
  /** The canonical, already-spliced cue track for this turn. */
  cues: AvatarCue[];
  /** Whether Pipecat playout has anchored a clock and issued `speak()`. */
  started: boolean;
  clock: (() => number) | null;
}

/**
 * Internal. Not exported from the package — see `index.ts` for the public
 * surface, which is `<Avatar>` and nothing else.
 *
 * There is deliberately no `accept` predicate here any more. Avatar commands
 * travel in one envelope, `{type:"avatar"}`, in both directions and from every
 * source: a `AvatarProcessor` in the pipeline and a brain driving the face
 * out of band emit the same shape. A per-deployment predicate meant the
 * library could not state what an avatar message *is*, which is the one thing
 * a wire format has to be able to say. See docs/removed.md § The accept
 * predicate.
 */
export interface AvatarClientOptions {
  /** A dispatch threw (e.g. an unknown state or interjection id, which the
   * widget throws on). Defaults to `console.warn`. */
  onError?: (err: unknown, msg: AvatarCommand) => void;
  /** Override for tests. Defaults to `performance.now`. */
  now?: () => number;
  /** Quiet time in listening before the client-owned idle loop begins. */
  idleDelayMs?: number;
  /** Timer seams keep lifecycle behavior deterministic in tests. */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
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
 * against the real ones from a type-only import. `client/test/AvatarClient.test.ts`
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
} as const satisfies Record<string, string>;

type LifecycleState = "IDLE" | "LISTENING" | "THINKING" | "TYPING" | "SPEAKING" | "DEGRADED" | "OFFLINE";
type ServerClaim = "THINKING" | "WORKING" | null;

/** Defensive unwrap for the `RTVIEvent.ServerMessage` `{ data }` quirk: some
 * transports deliver the payload directly and some wrap it once more. */
function unwrapServerMessage(raw: unknown): Record<string, unknown> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const inner = obj["data"] as Record<string, unknown> | undefined;
  return inner && "type" in inner ? inner : obj;
}

export class AvatarClient {
  private readonly avatar: AvatarApi;
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
  private listening = false;
  private idle = true;
  private failure: "DEGRADED" | "OFFLINE" | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInterruptedAction = false;
  private discardQueuedContextsOnBotStop = false;
  private readonly idleDelayMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(avatar: AvatarApi, opts: AvatarClientOptions = {}) {
    this.avatar = avatar;
    this.opts = opts;
    this.now = opts.now ?? (() => performance.now());
    this.idleDelayMs = opts.idleDelayMs ?? 12_000;
    this.setTimer = opts.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimer = opts.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  }

  /** The active turn's ctx, or `null` between turns. For tests and telemetry. */
  get turnCtx(): string | null {
    return this.turn?.ctx ?? null;
  }

  /** The active turn's canonical (already-spliced) cue track. For tests and telemetry. */
  get turnCues(): AvatarCue[] {
    return this.turn ? [...this.turn.cues] : [];
  }

  /** Dispatch one server message. Anything that isn't in the avatar envelope
   * is not ours and is ignored; so is an envelope carrying a `cmd` this build
   * has never heard of, per the wire protocol's forward-compat rule. */
  dispatch(raw: unknown): void {
    if (!isAvatarMessage(raw)) return;
    const msg: AvatarCommand = raw;
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
        // not an interface (`docs/removed.md` § Client callbacks).
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

  private handleAction(id: string): void {
    // An interruption is a server-confirmed explanation of a transition, not
    // authority to steal the mouth while bot audio is still playing. Hold it
    // until playout has released the speaking state.
    if (id === "RESPONSE_INTERRUPTED" && this.botSpeaking) {
      this.pendingInterruptedAction = true;
      // Any prefetched TTS contexts behind an interrupted playout belong to
      // audio Pipecat will now discard. Never let one animate a later reply.
      this.discardQueuedContextsOnBotStop = true;
      return;
    }
    this.playAction(id);
  }

  private playAction(id: string): void {
    this.avatar.action(id);
  }

  private ensureTurn(ctx: string): Turn {
    const existing = this.turns.get(ctx);
    if (existing) return existing;
    const turn = { ctx, cues: [], started: false, clock: null };
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
      // No clock yet — buffer. Pipecat playout will claim this FIFO context.
      if (this.botSpeaking && this.turn === null) this.activateNextTurn();
      return;
    }
    if (discarded === 0) {
      this.avatar.pushCues(msg.cues);
    } else {
      this.avatar.speak({ cues: turn.cues, clock: turn.clock! });
    }
  }

  private activateNextTurn(): void {
    if (this.turn) return;
    let turn: Turn | undefined;
    while (this.pendingCtxs.length && !turn) {
      turn = this.turns.get(this.pendingCtxs.shift()!);
    }
    if (!turn) return;
    const t0 = this.now();
    turn.clock = () => this.now() - t0;
    turn.started = true;
    this.turn = turn;
    this.avatar.speak({ cues: turn.cues, clock: turn.clock });
  }

  private discardQueuedTurns(): void {
    for (const ctx of this.pendingCtxs.splice(0)) {
      this.closedCtxs.add(ctx);
      this.turns.delete(ctx);
    }
  }

  private lifecycleState(): LifecycleState {
    if (this.failure) return this.failure;
    // Audio truth is the P0 invariant: no lower claim or microphone event may
    // put the face in a non-speaking pose while bot speech is audible.
    if (this.botSpeaking) return "SPEAKING";
    if (this.userSpeaking) return "LISTENING";
    if (this.serverClaim === "WORKING") return "TYPING";
    if (this.serverClaim === "THINKING") return "THINKING";
    if (this.idle) return "IDLE";
    return "LISTENING";
  }

  private applyProjection(force = false): void {
    const state = this.lifecycleState();
    if (force || this.projected !== state) {
      this.avatar.setState(state);
      this.projected = state;
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
    if (!this.listening || this.userSpeaking || this.botSpeaking || this.serverClaim || this.failure) return;
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null;
      if (!this.userSpeaking && !this.botSpeaking && !this.serverClaim && !this.failure) {
        this.idle = true;
        this.applyProjection();
      }
    }, this.idleDelayMs);
  }

  private enterListening(): void {
    this.listening = true;
    this.idle = false;
    this.applyProjection();
    this.armIdleIfEligible();
  }

  private clearClaimForTurnBoundary(): void {
    // Claims are lower-priority hints. A fresh user turn or real playout means
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
    this.applyProjection();
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
    ];
    for (const [event, listener] of subscriptions) client.on(event as RTVIEvent, listener as never);
    return () => {
      this.clearIdleTimer();
      for (const [event, listener] of subscriptions) client.off(event as RTVIEvent, listener as never);
    };
  }
}
