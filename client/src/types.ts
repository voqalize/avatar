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

export interface AvatarStateCmd {
  cmd: "state";
  name: string;
  emotion?: string;
  gaze?: string;
}

export interface AvatarInterjectCmd {
  cmd: "interject";
  id: string;
}

/**
 * A hand gesture — the hand at the frame edge plus its face half. Separate from
 * `interject` on purpose: `interject("WAVE")` is the face alone and always was,
 * so a server that upgrades gets no hand until it asks for one.
 */
export interface AvatarGestureCmd {
  cmd: "gesture";
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
   * ahead, and `speech stop` remains the end of the turn. It is safe to release
   * per-turn cue state (the splice buffer for `ctx`) once the last cue has
   * played, and safe to stop expecting more.
   *
   * Absent on an interrupted turn, deliberately: a turn that was cut never
   * claims to have completed. Absent chunks are the normal case — the widget's
   * own track already completes on the trailing `X`, so ignoring `final`
   * entirely is a correct implementation.
   */
  final?: boolean;
}

export interface AvatarSpeechCmd {
  cmd: "speech";
  event: "start" | "stop";
  ctx: string;
}

export interface AvatarUserCmd {
  cmd: "user";
  speaking: boolean;
}

export type AvatarCommand =
  | AvatarStateCmd
  | AvatarInterjectCmd
  | AvatarGestureCmd
  | AvatarCuesCmd
  | AvatarSpeechCmd
  | AvatarUserCmd;

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
