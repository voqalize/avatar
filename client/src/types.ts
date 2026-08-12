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

/** A viseme cue: `t` is a ms offset into the utterance's clock, `v` is a Rhubarb A–H (or X) letter. */
export interface AvatarCue {
  t: number;
  v: string;
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
  id: string;
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

/**
 * Is this server-message payload the avatar's? The envelope is the whole
 * answer: `{type:"avatar"}` with a string `cmd`. It used to be a per-deployment
 * `accept` predicate on the client, which meant the library could not state
 * what an avatar message *is* — see `docs/removed.md` § The accept predicate.
 */
export function isAvatarMessage(msg: unknown): msg is AvatarServerMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === AVATAR_MESSAGE_TYPE && typeof m.cmd === "string";
}

/** The envelope `type` the protocol reserves for avatar traffic. */
export const AVATAR_MESSAGE_TYPE = "avatar";
