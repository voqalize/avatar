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
 * `{ type: "avatar", v: 1, ...cmd-specific fields }`. {@link AvatarCommand}
 * describes the *payload*, not the envelope, because the payload is what
 * arrives however the host chose to carry it — `AvatarClient.dispatch()`
 * accepts anything with a string `cmd`, so an application that tunnels these
 * through its own message type can hand them straight over.
 */

/** A viseme cue: `t` is a ms offset into the utterance's clock, `v` is a Rhubarb A–H (or X) letter. */
export interface AvatarCue {
  t: number;
  v: string;
  i?: number;
}

/** `perform()` timeline action — see docs/contract-protocol.md § Composing behavior. */
export interface AvatarPerformAction {
  t: number;
  do: "state" | "emotion" | "gaze" | "interject";
  name?: string;
  id?: string;
  i?: number;
  keepGaze?: boolean;
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

export interface AvatarPerformCmd {
  cmd: "perform";
  actions: AvatarPerformAction[];
  ctx?: string;
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

export interface AvatarHintCmd {
  cmd: "hint";
  kind: "eager_eot" | (string & {});
}

/** A cmd this build doesn't recognize — dispatched to nothing, ignored for forward compat. */
export interface AvatarUnknownCmd {
  cmd: string;
  [key: string]: unknown;
}

export type AvatarCommand =
  | AvatarStateCmd
  | AvatarInterjectCmd
  | AvatarPerformCmd
  | AvatarCuesCmd
  | AvatarSpeechCmd
  | AvatarUserCmd
  | AvatarHintCmd
  | AvatarUnknownCmd;

/** The full server-message payload: the avatar envelope plus its `cmd`. */
export type AvatarServerMessage = AvatarCommand & {
  type?: "avatar";
  v?: number;
};

/** Narrows an unknown server-message payload to an avatar command. */
export function isAvatarMessage(msg: unknown): msg is AvatarServerMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return typeof m.cmd === "string";
}

/** The envelope `type` the protocol reserves for avatar traffic. */
export const AVATAR_MESSAGE_TYPE = "avatar";

/** The protocol version this client speaks — matches `AVATAR_PROTOCOL_VERSION`
 * in the Python package. Sent as `v` and, today, never checked: an unknown
 * `cmd` is ignored rather than version-gated, which is the forward-compat rule
 * the contract states. */
export const AVATAR_PROTOCOL_VERSION = 1;
