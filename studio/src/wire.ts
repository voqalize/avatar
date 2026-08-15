/**
 * The avatar wire, read a second time.
 *
 * `@voqalize/avatar/internal` exports a reader for exactly this, and Studio
 * deliberately does not use it. Studio's job is to be the surface an integrator
 * copies from, and an integrator has the published `createAvatar` and
 * `docs/contract-wire.md` — not our internals. So this file is written from the
 * document, and if the document is not enough to write it, that is a defect in
 * the document rather than a reason to import.
 *
 * It is a reader, not a validator. The library's own reader drops what it
 * cannot act on; this one keeps as much as it can name, because a message the
 * face ignored is precisely what you came here to see.
 */

/** A durable, lower-priority server claim. `null` explicitly clears it. */
export interface WireClaim {
  cmd: "claim";
  state: string | null;
}

/** A self-completing authored sequence. */
export interface WireAction {
  cmd: "action";
  id: string;
}

export interface WireCue {
  t: number;
  v: string;
  i?: number;
}

export interface WireCues {
  cmd: "cues";
  ctx: string;
  from_ms: number;
  cues: WireCue[];
  final?: boolean;
}

/** Something addressed to the avatar whose `cmd` this build has no name for. */
export interface WireUnknown {
  cmd: string;
}

export type WireCommand = WireClaim | WireAction | WireCues | WireUnknown;

const envelope = (raw: unknown): Record<string, unknown> | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  return m.type === "avatar" && typeof m.cmd === "string" ? m : null;
};

/**
 * Pull an avatar command out of a `serverMessage` payload, or `null` if the
 * message was not addressed to the avatar at all.
 *
 * The double unwrap is not defensive coding: some pipecat server-message paths
 * deliver the payload bare and some wrap it in `{ data }`, and a page that
 * handled only one of them would show an empty log against a working call.
 */
export function readAvatarMessage(raw: unknown): WireCommand | null {
  const m = envelope(raw) ?? envelope((raw as { data?: unknown } | null)?.data);
  if (!m) return null;
  switch (m.cmd) {
    case "claim":
      return { cmd: "claim", state: typeof m.state === "string" ? m.state : null };
    case "action":
      return { cmd: "action", id: String(m.id) };
    case "cues":
      return {
        cmd: "cues",
        ctx: String(m.ctx),
        from_ms: Number(m.from_ms),
        cues: Array.isArray(m.cues) ? (m.cues as WireCue[]) : [],
        ...(m.final === true ? { final: true as const } : {}),
      };
    default:
      return { cmd: m.cmd as string };
  }
}

/** One line, in the vocabulary the wire actually uses. */
export function describe(cmd: WireCommand): string {
  if (cmd.cmd === "claim") return `claim ${(cmd as WireClaim).state ?? "null"}`;
  if (cmd.cmd === "action") return `action ${(cmd as WireAction).id}`;
  if (cmd.cmd === "cues") {
    const c = cmd as WireCues;
    // The ctx is a UUID and only ever read as "same turn or a new one", so a
    // prefix does the whole job. Printed in full it wraps to two lines and a
    // burst of cue chunks stops being readable as a burst.
    return `cues ${c.ctx.slice(0, 6)} from ${c.from_ms}ms ×${c.cues.length}${c.final ? " final" : ""}`;
  }
  return `${cmd.cmd} — this build has no name for it`;
}
