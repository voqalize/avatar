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
 * `attach()` therefore subscribes to exactly one pipecat event,
 * `serverMessage`. It used to also subscribe to both speaking events to report
 * a diagnostic drift between our anchor and pipecat's; that hook is gone with
 * the rest of the observability surface (`docs/removed.md` § Client callbacks).
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
  isAvatarMessage,
  type AvatarCommand,
  type AvatarCue,
  type AvatarCuesCmd,
  type AvatarSpeechCmd,
  type AvatarStateCmd,
} from "./types.js";


interface Turn {
  ctx: string;
  /** The canonical, already-spliced cue track for this turn. */
  cues: AvatarCue[];
  /** Whether `speech start` has anchored a clock and issued the first `speak()`. */
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
  private turn: Turn | null = null;

  constructor(avatar: AvatarApi, opts: AvatarClientOptions = {}) {
    this.avatar = avatar;
    this.opts = opts;
    this.now = opts.now ?? (() => performance.now());
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
        case "state":
          this.handleState(msg);
          break;
        case "interject":
          this.avatar.interject(msg.id);
          break;
        case "gesture":
          this.avatar.gesture(msg.id);
          break;
        case "cues":
          this.handleCues(msg);
          break;
        case "speech":
          this.handleSpeech(msg);
          break;
        case "user":
          this.avatar.setUserSpeaking(msg.speaking);
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

  private handleState(msg: AvatarStateCmd) {
    // Deliberately no client-side dedup: pass every `state` command straight
    // through. The widget's own setState already no-ops the parts that matter
    // for an unchanged name (`changed` gates the blink and the 'state' event in
    // avatar.js), and a server resending the same state name as a
    // keepalive/resync must still land so an `emotion`/`gaze` override on this
    // particular message takes effect.
    this.avatar.setState(msg.name, { emotion: msg.emotion, gaze: msg.gaze });
  }

  private ensureTurn(ctx: string): Turn {
    if (!this.turn || this.turn.ctx !== ctx) {
      // A different ctx supersedes whatever turn we had — a stale trailing
      // message for the old ctx will find `this.turn.ctx !== ctx` in
      // handleSpeech's stop-guard and be ignored, rather than cutting off the
      // new turn.
      this.turn = { ctx, cues: [], started: false, clock: null };
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

  /**
   * Subscribe to a live `PipecatClient`'s server messages and dispatch the
   * avatar commands among them — the ones in the protocol's own
   * `{type:"avatar"}` envelope, which `isAvatarMessage` is the definition of.
   * Never throws on a malformed or irrelevant message.
   *
   * @returns an unsubscribe function; call it on unmount or disconnect.
   */
  attach(client: PipecatClient): () => void {
    const onServerMessage = (raw: unknown) => this.dispatch(unwrapServerMessage(raw));
    const serverMessage = RTVI_EVENTS.serverMessage as RTVIEvent;
    client.on(serverMessage, onServerMessage);
    return () => client.off(serverMessage, onServerMessage);
  }
}
