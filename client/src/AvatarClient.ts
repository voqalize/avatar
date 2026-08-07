/**
 * AvatarClient — the avatar's server-message dispatcher, turn clock, and cue
 * splice, framework-free (no React; the hook and component wrap this).
 *
 * ## Turn clock anchoring
 *
 * A turn's `t0` is anchored to `performance.now()` **at the moment this client
 * receives the `{cmd:"speech", event:"start"}` message** — cues are
 * client-anchored, not per-cue server-released. That message rides the RTVI
 * data channel, ahead of the jitter-buffered audio path, so the residual error
 * lands on the video-leads side — the side `docs/contract-protocol.md` says
 * perceptual tolerance favours (+125 ms vs -45 ms).
 *
 * We investigated anchoring on pipecat client-js's own `RTVIEvent
 * .BotStartedSpeaking`/`BotStoppedSpeaking` instead (or as a refinement) and
 * chose not to, for two reasons:
 *
 *   1. **No turn correlation.** Those events carry no payload — no `ctx` — so
 *      there is no way to tell which turn a firing belongs to. Our own
 *      `speech` command carries `ctx`, which the splice logic below needs
 *      regardless, so anchoring off it costs nothing extra.
 *   2. **Same source, same path, no accuracy gain.** The `AvatarProcessor`
 *      sits between the TTS service and the output transport and observes the
 *      transport's own `BotStarted/StoppedSpeakingFrame` broadcasts — the exact
 *      frame pipecat's built-in speaking detection is *also* driven from. Both
 *      notifications travel the same data-channel path to the browser. There is
 *      no local "truly audible now" signal cheaply available: the audio arrives
 *      on a `MediaStreamTrack` whose only lifecycle events (`unmute`/`mute`)
 *      fire once per call, not per utterance. Tapping the decoded remote audio
 *      with a WebAudio `AnalyserNode` RMS gate *would* give one, but it adds
 *      its own onset latency and a real audio pipeline to build and tune, and
 *      it would eat into the intentional video-first safety margin rather than
 *      improve it. Left as a documented option, not built.
 *
 * `attach()` still subscribes to both pipecat events, but only to report a
 * **diagnostic** drift (`onSpeakingDrift`) between our anchor and pipecat's —
 * useful for noticing in logs if the two ever separate by more than jitter,
 * never used to move `t0` itself.
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
 * Cues commonly arrive **before** `speech start` — the fast leg starts the
 * moment a sentence is handed to TTS, well before `BotStartedSpeakingFrame`.
 * Chunks that arrive before the clock is anchored are spliced into the
 * canonical array but not yet handed to the widget; `speech start` hands over
 * whatever has accumulated as the turn's first `speak()` call. So "the first
 * chunk of a turn starts speak()" means the first *widget* call, not
 * necessarily the first *message*.
 */

import type { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import type { AvatarApi } from "../../src/avatar.js";
import {
  AVATAR_MESSAGE_TYPE,
  isAvatarMessage,
  type AvatarCommand,
  type AvatarCue,
  type AvatarCuesCmd,
  type AvatarHintCmd,
  type AvatarPerformCmd,
  type AvatarSpeechCmd,
  type AvatarStateCmd,
  type AvatarUnknownCmd,
} from "./types.js";

interface Turn {
  ctx: string;
  /** The canonical, already-spliced cue track for this turn. */
  cues: AvatarCue[];
  /** Whether `speech start` has anchored a clock and issued the first `speak()`. */
  started: boolean;
  clock: (() => number) | null;
  t0: number | null;
}

export interface AvatarClientOptions {
  /** `{cmd:"hint"}` is a no-op hook today — the widget's listening engine
   * already handles acks; a host may still want to know a hint arrived. */
  onHint?: (kind: string, msg: AvatarHintCmd) => void;
  /** An unrecognized `cmd` (forward compat) — the protocol says ignore
   * silently, so this is purely an observability hook, not required. */
  onUnknownCmd?: (msg: AvatarUnknownCmd) => void;
  /** A dispatch threw (e.g. an unknown state or interjection id, which the
   * widget throws on). Defaults to `console.warn`. */
  onError?: (err: unknown, msg: AvatarCommand) => void;
  /** Diagnostic only (see the class doc's "Turn clock anchoring" section) —
   * never moves the anchor, just reports how far pipecat's own
   * botStartedSpeaking/botStoppedSpeaking landed from it. */
  onSpeakingDrift?: (info: { event: "start" | "stop"; ctx: string | null; driftMs: number }) => void;
  /**
   * Which server-messages `attach()` should look inside. Defaults to the
   * protocol's own envelope, `type === "avatar"`.
   *
   * The escape hatch exists because an application may tunnel avatar commands
   * inside a message type of its own — one deployment routes them through a
   * generic `ui_command` envelope so an LLM tool call can drive the face — and
   * teaching this library that envelope would be teaching it one consumer's
   * private vocabulary. Widen it here instead:
   *
   *     accept: (m) => m.type === "avatar" ||
   *                    (m.type === "ui_command" && m.action === "avatar")
   *
   * The predicate only decides *whether to look*; the payload still has to
   * carry a string `cmd` to dispatch at all.
   */
  accept?: (message: Record<string, unknown>) => boolean;
  /** Override for tests. Defaults to `performance.now`. */
  now?: () => number;
}

/**
 * The three `RTVIEvent` members `attach()` subscribes to, spelled as their
 * values.
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
  botStartedSpeaking: "botStartedSpeaking",
  botStoppedSpeaking: "botStoppedSpeaking",
} as const satisfies Record<string, string>;

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
  private readonly accept: (message: Record<string, unknown>) => boolean;
  private turn: Turn | null = null;

  constructor(avatar: AvatarApi, opts: AvatarClientOptions = {}) {
    this.avatar = avatar;
    this.opts = opts;
    this.now = opts.now ?? (() => performance.now());
    this.accept = opts.accept ?? ((m) => m.type === AVATAR_MESSAGE_TYPE);
  }

  /** The active turn's ctx, or `null` between turns. For tests and telemetry. */
  get turnCtx(): string | null {
    return this.turn?.ctx ?? null;
  }

  /** The active turn's canonical (already-spliced) cue track. For tests and telemetry. */
  get turnCues(): AvatarCue[] {
    return this.turn ? [...this.turn.cues] : [];
  }

  /** Dispatch one avatar command. Accepts anything with a string `cmd` — an
   * already-unwrapped `{type:"avatar", cmd, ...}` server message, or a bare
   * `{cmd, ...}` payload from whatever else the host is carrying them in.
   * Unknown `cmd`s are ignored, per the wire protocol's forward-compat rule. */
  dispatch(raw: unknown): void {
    if (!isAvatarMessage(raw)) return;
    const msg = raw;
    try {
      switch (msg.cmd) {
        case "state":
          this.handleState(msg as AvatarStateCmd);
          break;
        case "interject":
          this.avatar.interject((msg as { id: string }).id);
          break;
        case "perform":
          this.handlePerform(msg as AvatarPerformCmd);
          break;
        case "cues":
          this.handleCues(msg as AvatarCuesCmd);
          break;
        case "speech":
          this.handleSpeech(msg as AvatarSpeechCmd);
          break;
        case "user":
          this.avatar.setUserSpeaking((msg as { speaking: boolean }).speaking);
          break;
        case "hint": {
          const hint = msg as AvatarHintCmd;
          this.opts.onHint?.(hint.kind, hint);
          break;
        }
        default:
          this.opts.onUnknownCmd?.(msg as AvatarUnknownCmd);
          break;
      }
    } catch (err) {
      if (this.opts.onError) this.opts.onError(err, msg);
      else console.warn("[avatar] dispatch failed", msg, err);
    }
  }

  private handleState(msg: AvatarStateCmd) {
    // Deliberately no client-side dedup: pass every `state` command straight
    // through. The widget's own setState already no-ops the parts that matter
    // for an unchanged name (`changed` gates the blink and the 'state' event in
    // avatar.js), and a server resending the same state name as a
    // keepalive/resync must still land so an `emotion`/`gaze` override on this
    // particular message takes effect.
    this.avatar.setState(msg.name, { emotion: msg.emotion, gaze: msg.gaze });
  }

  private handlePerform(msg: AvatarPerformCmd) {
    this.avatar.perform(msg.actions, { clock: this.resolveClock(msg.ctx) });
  }

  /** Ride the named turn's clock if it's the one we're currently anchored to;
   * otherwise (no active turn, or `perform` names a ctx we never saw a
   * `speech start` for) fall back to a fresh clock anchored at this call — the
   * same "elapsed ms since this call" default `avatar.perform()` itself uses
   * when given no clock and no audio. */
  private resolveClock(ctx: string | undefined): () => number {
    if (ctx && this.turn && this.turn.ctx === ctx && this.turn.clock) {
      return this.turn.clock;
    }
    const start = this.now();
    return () => this.now() - start;
  }

  private ensureTurn(ctx: string): Turn {
    if (!this.turn || this.turn.ctx !== ctx) {
      // A different ctx supersedes whatever turn we had — a stale trailing
      // message for the old ctx will find `this.turn.ctx !== ctx` in
      // handleSpeech's stop-guard and be ignored, rather than cutting off the
      // new turn.
      this.turn = { ctx, cues: [], started: false, clock: null, t0: null };
    }
    return this.turn;
  }

  private handleCues(msg: AvatarCuesCmd) {
    const turn = this.ensureTurn(msg.ctx);
    const kept = turn.cues.filter((c) => c.t < msg.from_ms);
    const discarded = turn.cues.length - kept.length;
    turn.cues = [...kept, ...msg.cues].sort((a, b) => a.t - b.t);

    if (!turn.started) {
      // No clock yet — buffer. `speech start` will hand this over as the turn's
      // first speak() call.
      return;
    }
    if (discarded === 0) {
      this.avatar.pushCues(msg.cues);
    } else {
      this.avatar.speak({ cues: turn.cues, clock: turn.clock! });
    }
  }

  private handleSpeech(msg: AvatarSpeechCmd) {
    if (msg.event === "start") {
      const turn = this.ensureTurn(msg.ctx);
      const t0 = this.now();
      const clock = () => this.now() - t0;
      turn.t0 = t0;
      turn.clock = clock;
      turn.started = true;
      this.avatar.speak({ cues: turn.cues, clock });
      return;
    }
    // "stop": only act if it names the turn we're actually riding. A stale stop
    // for an already-superseded ctx must not cut off a newer turn.
    if (this.turn && this.turn.ctx === msg.ctx) {
      this.avatar.stopSpeaking();
      this.turn = null;
    }
  }

  private reportDrift(event: "start" | "stop") {
    if (!this.opts.onSpeakingDrift) return;
    const t0 = this.turn?.t0;
    if (t0 == null) return;
    this.opts.onSpeakingDrift({ event, ctx: this.turn?.ctx ?? null, driftMs: this.now() - t0 });
  }

  /**
   * Subscribe to a live `PipecatClient`'s server messages and dispatch the
   * avatar commands among them. Which messages count is the `accept` option;
   * by default, the protocol's own `{type:"avatar"}` envelope.
   *
   * Also wires the diagnostic drift cross-check described in the class doc.
   * Never throws on a malformed or irrelevant message.
   *
   * @returns an unsubscribe function; call it on unmount or disconnect.
   */
  attach(client: PipecatClient): () => void {
    const onServerMessage = (raw: unknown) => {
      const message = unwrapServerMessage(raw);
      if (!this.accept(message)) return;
      this.dispatch(message);
    };
    const onBotStartedSpeaking = () => this.reportDrift("start");
    const onBotStoppedSpeaking = () => this.reportDrift("stop");

    const serverMessage = RTVI_EVENTS.serverMessage as RTVIEvent;
    const started = RTVI_EVENTS.botStartedSpeaking as RTVIEvent;
    const stopped = RTVI_EVENTS.botStoppedSpeaking as RTVIEvent;

    client.on(serverMessage, onServerMessage);
    client.on(started, onBotStartedSpeaking);
    client.on(stopped, onBotStoppedSpeaking);

    return () => {
      client.off(serverMessage, onServerMessage);
      client.off(started, onBotStartedSpeaking);
      client.off(stopped, onBotStoppedSpeaking);
    };
  }
}
