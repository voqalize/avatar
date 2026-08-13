/**
 * types.ts — the avatar wire vocabulary, client side.
 *
 * The binding definition is `docs/contract-protocol.md`; this file is its
 * TypeScript restatement and must not drift from it. The Python half of the
 * same vocabulary is `py/src/voqalize_avatar/messages.py` — the three are
 * maintained together, and a command added to one without the others is
 * incomplete.
 *
 * A server pushes these as RTVI `server-message`s under the envelope
 * `{ type: "avatar", ...cmd-specific fields }`. {@link AvatarCommand} describes
 * what rides inside that envelope; {@link isAvatarMessage} is the envelope
 * itself, and is the only definition of "this message is for the avatar" the
 * client has. There is no protocol version field — see `docs/removed.md`
 * § The `v` field.
 */

import { ACTION_IDS, VISEME_LETTERS } from "../../src/avatar.js";
import type { AvatarActionId, VisemeLetter } from "../../src/avatar.js";

/** A viseme cue: `t` is a ms offset into the utterance's clock, `v` is a Rhubarb A–H (or X) letter. */
export interface AvatarCue {
  t: number;
  v: VisemeLetter;
  /** 0..1 loudness. Absent means full. */
  i?: number;
}

/** A durable, lower-priority server claim. `null` explicitly clears it. */
export interface AvatarClaimCmd {
  cmd: "claim";
  state: "THINKING" | "WORKING" | null;
}

/** A self-completing authored sequence: face, body, and optionally a hand. */
export interface AvatarActionCmd {
  cmd: "action";
  id: AvatarActionId;
}

export interface AvatarCuesCmd {
  cmd: "cues";
  ctx: string;
  /** Discard queued cues at or after this offset (ms), then append `cues`. */
  from_ms: number;
  cues: AvatarCue[];
  /**
   * True on the one chunk that completes this turn's track: the TTS context is
   * closed, so no further chunk will splice into `ctx`. What a client may
   * assume, exactly — nothing about playout. The audio it describes is still
   * ahead, and Pipecat's `botStoppedSpeaking` remains the end of the turn. It
   * is safe to stop expecting more cue chunks after `final`.
   *
   * Absent on an interrupted turn, deliberately: a turn that was cut never
   * claims to have completed. Absent chunks are the normal case — the widget's
   * own track already completes on the trailing `X`, so ignoring `final`
   * entirely is a correct implementation.
   */
  final?: boolean;
}

export type AvatarCommand =
  | AvatarClaimCmd
  | AvatarActionCmd
  | AvatarCuesCmd;

/** The full server-message payload: the envelope plus its command. */
export type AvatarServerMessage = AvatarCommand & { type: "avatar" };

/** An envelope addressed to the avatar, before its payload has been read. */
export type AvatarEnvelope = { type: "avatar"; cmd: string } & Record<string, unknown>;

/**
 * Is this server-message payload the avatar's? The envelope is the whole
 * answer: `{type:"avatar"}` with a string `cmd`. It used to be a per-deployment
 * `accept` predicate on the client, which meant the library could not state
 * what an avatar message *is* — see `docs/removed.md` § The accept predicate.
 *
 * Addressed to us is not the same as understood by us: {@link parseAvatarCommand}
 * is the second half.
 */
export function isAvatarMessage(msg: unknown): msg is AvatarEnvelope {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === AVATAR_MESSAGE_TYPE && typeof m.cmd === "string";
}

const ACTIONS = new Set<string>(ACTION_IDS);
const LETTERS = new Set<string>(VISEME_LETTERS);

/**
 * Read an envelope's payload into the wire vocabulary, or `null` if this build
 * cannot act on it — an unknown `cmd`, an id or claim outside the enum, a
 * malformed `cues` chunk.
 *
 * `null` is the forward-compat rule with a type attached: a newer server
 * talking to an older widget is *expected*, and the older widget ignores what
 * it does not know rather than guessing. Doing the check here rather than at
 * each use site is what lets the wire types be closed unions instead of
 * `string` — the boundary is one function, so it can be the only place that
 * has to be honest about untrusted input.
 *
 * Cues survive individually: one unrecognised letter in a chunk drops that cue,
 * not the utterance around it. Losing a frame of articulation is a far smaller
 * regression than losing a sentence of it.
 */
export function parseAvatarCommand(msg: AvatarEnvelope): AvatarCommand | null {
  switch (msg.cmd) {
    case "claim": {
      const state = msg.state;
      if (state === null || state === "THINKING" || state === "WORKING") {
        return { cmd: "claim", state };
      }
      return null;
    }
    case "action":
      return typeof msg.id === "string" && ACTIONS.has(msg.id)
        ? { cmd: "action", id: msg.id as AvatarActionId }
        : null;
    case "cues": {
      if (typeof msg.ctx !== "string" || !Number.isFinite(msg.from_ms) || !Array.isArray(msg.cues)) {
        return null;
      }
      const cues: AvatarCue[] = [];
      for (const c of msg.cues as unknown[]) {
        if (typeof c !== "object" || c === null) continue;
        const { t, v, i } = c as Record<string, unknown>;
        if (typeof t !== "number" || !Number.isFinite(t)) continue;
        if (typeof v !== "string" || !LETTERS.has(v)) continue;
        cues.push(typeof i === "number" ? { t, v: v as VisemeLetter, i } : { t, v: v as VisemeLetter });
      }
      return {
        cmd: "cues",
        ctx: msg.ctx,
        from_ms: msg.from_ms as number,
        cues,
        ...(msg.final === true ? { final: true as const } : {}),
      };
    }
    default:
      return null;
  }
}

/** The envelope `type` the protocol reserves for avatar traffic. */
export const AVATAR_MESSAGE_TYPE = "avatar";
