/**
 * types.ts — the avatar wire vocabulary, client side.
 *
 * The binding definition is `docs/contract-wire.md`; this file is its
 * TypeScript restatement and must not drift from it. The Python half of the
 * same vocabulary is `packages/avatar-py/src/voqalize_avatar/messages.py` — the three are
 * maintained together, and a command added to one without the others is
 * incomplete.
 *
 * A server pushes these as RTVI `server-message`s under the envelope
 * `{ type: "avatar", ...cmd-specific fields }`. {@link AvatarCommand} describes
 * what rides inside that envelope; {@link isAvatarMessage} is the envelope
 * itself, and is the only definition of "this message is for the avatar" the
 * client has. There is no protocol version field — an unknown `cmd` is simply
 * ignored, which is the whole forward-compatibility rule.
 */

import { VISEME_LETTERS } from "../src/avatar.js";
import type { VisemeLetter } from "../src/avatar.js";

/** A viseme cue: `t` is a ms offset into the utterance's clock, `v` is a Rhubarb A–H (or X) letter. */
export interface AvatarCue {
  t: number;
  v: VisemeLetter;
  /** 0..1 loudness. Absent means full. */
  i?: number;
  /**
   * The phone being articulated under `v`, absent during silence.
   *
   * `v` is a nine-way projection of the recogniser's ~40 phones and the loss is
   * concentrated — `B` alone absorbs IY, IH, T, D, CH, JH, TH, DH, S, Z, SH,
   * ZH, N and Y — so a renderer with a mouth for "tongue between the teeth"
   * cannot ask for it from `v` and can from here. **Not a closed set**: it is
   * whatever the engine labels its own segments with, which today is Arpabet
   * plus `Schwa` and four non-speech labels, and a later engine may say
   * something else. Validated as an identifier and passed through unread —
   * the letter stays the thing every face must handle, and a face that wants
   * the finer signal opts in.
   */
  p?: string;
}

/**
 * A durable, lower-priority server state. `null` explicitly clears it.
 *
 * Three values, and the server can send no others: the remaining six of the
 * nine are Pipecat facts the browser already holds, and a server spelling of a
 * fact would be a second, lower-authority copy of it. It was `cmd: "claim"`
 * until the wire redesign, when the concept and the command were given the one
 * name the rest of the system already used for it.
 */
export interface AvatarStateCmd {
  cmd: "state";
  state: "CANT_HEAR" | "THINKING" | "WORKING" | null;
}

/**
 * One self-completing motion, by name: face, body, and optionally a hand.
 *
 * **The id is open.** Two of them — {@link CORE_ACTION_IDS} — are intents every
 * renderer owes a server and are the only ones a server may send without
 * knowing what is mounted. Everything else is a name from the mounted avatar's
 * own catalogue, and **an unknown one is ignored, not an error**: that is the
 * same forward-compatibility rule an unknown `cmd` gets, arrived at from the
 * other direction. There, a newer server meets an older widget; here, any
 * server meets a face that cannot do the thing. Neither is worth breaking a
 * call over, and there is deliberately no fallback — an action sits on top of a
 * state, so nothing is missing when one is dropped.
 *
 * This replaced a closed seven-id vocabulary plus a second command,
 * `sequence`, for a renderer's own motions. The split cost a promotion ritual
 * for every new portable intent and still could not say what the closed set was
 * for: the listening research separates a continuer nod from an assessment nod
 * from a realisation, and all three were the one id `ACK_NOD` spelled. Now the
 * server says *when* to acknowledge and the avatar owns the variety.
 */
export interface AvatarActionCmd {
  cmd: "action";
  id: string;
}

/**
 * The two actions every renderer must answer to.
 *
 * `ACKNOWLEDGE` is the whole backchannel family in one word — receipt, nod,
 * realisation, empathy — because which of those a face does is a rendering
 * decision and the server is not the one holding the drawing.
 * `RESPONSE_INTERRUPTED` is the one transition a server can explain and the
 * browser cannot infer.
 *
 * A renderer may draw either in its own shape; it may never redefine one, and
 * a name in its own catalogue never shadows one of these.
 */
export const CORE_ACTION_IDS = Object.freeze(["ACKNOWLEDGE", "RESPONSE_INTERRUPTED"] as const);

export type CoreActionId = (typeof CORE_ACTION_IDS)[number];

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
  | AvatarStateCmd
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
 * what an avatar message *is*.
 *
 * Addressed to us is not the same as understood by us: {@link parseAvatarCommand}
 * is the second half.
 */
export function isAvatarMessage(msg: unknown): msg is AvatarEnvelope {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === AVATAR_MESSAGE_TYPE && typeof m.cmd === "string";
}

/**
 * What an action id may look like. Not which ones exist — that is the mounted
 * avatar's business and this function has never met it. `CATEGORY_INTENT` in
 * upper case, bounded so a malformed or hostile message cannot smuggle
 * anything through as a name.
 */
const ACTION_ID = /^[A-Z][A-Z0-9_]{1,63}$/;
const LETTERS = new Set<string>(VISEME_LETTERS);
/**
 * What a phone label may look like. Letters only, because every label any
 * engine we have seen is one word of them — `AO`, `NG`, `Schwa`, `Breath` —
 * and the bound is what stops a name being a payload.
 */
const PHONE_LABEL = /^[A-Za-z]{1,12}$/;

/**
 * Read an envelope's payload into the wire vocabulary, or `null` if this build
 * cannot act on it — an unknown `cmd`, a state outside the three, an action id
 * that is not a name, a malformed `cues` chunk.
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
    // `claim` was this command's name, and `STRAINING` one of its values, until
    // the wire redesign. Both are accepted and translated here, in the one
    // place that reads untrusted input, so no layer above has ever heard of
    // either spelling. Servers that predate the rename keep working; the old
    // names appear nowhere else and come out when the last one has shipped.
    case "claim":
    case "state": {
      const state = msg.state === "STRAINING" ? "CANT_HEAR" : msg.state;
      if (state === null || state === "CANT_HEAR" || state === "THINKING" || state === "WORKING") {
        return { cmd: "state", state };
      }
      return null;
    }
    // `sequence` was a second command for the same thing: a name resolved
    // against the mounted avatar rather than against a closed list. Now that
    // `action` is that, the two are one command and the old one is an alias.
    case "sequence":
    case "action":
      // Shape only, both for a core id and for one of the avatar's own. There
      // is nothing to check a name against here — the catalogue belongs to
      // whatever is mounted, and this function has never met it.
      return typeof msg.id === "string" && ACTION_ID.test(msg.id)
        ? { cmd: "action", id: msg.id }
        : null;
    case "cues": {
      if (typeof msg.ctx !== "string" || !Number.isFinite(msg.from_ms) || !Array.isArray(msg.cues)) {
        return null;
      }
      const cues: AvatarCue[] = [];
      for (const c of msg.cues as unknown[]) {
        if (typeof c !== "object" || c === null) continue;
        const { t, v, i, p } = c as Record<string, unknown>;
        if (typeof t !== "number" || !Number.isFinite(t)) continue;
        if (typeof v !== "string" || !LETTERS.has(v)) continue;
        const cue: AvatarCue = { t, v: v as VisemeLetter };
        if (typeof i === "number") cue.i = i;
        // Bounded as a name, not checked against a list. The set belongs to
        // whatever produced the cue, so enumerating it here would make this
        // library the thing that has to be released before a better recogniser
        // can say a new word.
        if (typeof p === "string" && PHONE_LABEL.test(p)) cue.p = p;
        cues.push(cue);
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
