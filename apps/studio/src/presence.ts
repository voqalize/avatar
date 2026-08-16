/**
 * A second reading of the call, resolved from the wire rather than asked for.
 *
 * The avatar holds no state a caller may query — `createAvatar` returns
 * `{ destroy }` and that is the whole public surface — so there is no "what are
 * you showing" to read. This module works the way the face does: subscribe to
 * the same Pipecat events, decode the same `serverMessage` traffic, run the same
 * ladder. When it and the drawing disagree, the disagreement is the finding, and
 * that only holds because nothing here is wired to the avatar.
 *
 * It is written from the two contract documents alone — `docs/contract-wire.md`
 * for the envelope, `docs/pipecat-lifecycle-protocol.md § Authority model` for
 * the order — and not from `packages/avatar/client/AvatarClient.ts`. That is the point of
 * having it: it is the repo's only wire reader by someone who read the spec
 * instead of the implementation.
 */

import { useCallback, useEffect, useState } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { useRTVIClientEvent } from "@pipecat-ai/client-react";

/** The library's nine, minus the two only a failure produces. See below. */
export type Presence =
  | "SPEAKING"
  | "LISTENING"
  | "STRAINING"
  | "THINKING"
  | "WORKING"
  | "MUTED"
  | "IDLE";

/** The three states a server may claim (contract-wire.md § claim). */
type Claim = "STRAINING" | "THINKING" | "WORKING";

const CLAIMS: readonly string[] = ["STRAINING", "THINKING", "WORKING"];

/**
 * How long quiet has to last before it is idleness rather than a gap.
 *
 * Restated here because it is not on the wire: it is the widget's own default,
 * and a page that could read it would be reading avatar state. So this number
 * can drift from the library's, and a status line that says IDLE some seconds
 * before or after the face steps back is exactly the drift being watched for.
 */
export const IDLE_AFTER_MS = 12_000;

/**
 * The resolved state, or `null` when there is no call to resolve.
 *
 * Two of the library's nine states never appear here. `OFFLINE` and `DEGRADED`
 * are what the *avatar* shows when the session breaks under it, and this page
 * already has that from the transport, in the transport's own words — a second
 * spelling of "the call is not up" next to the connect button would be the
 * status line competing with the button.
 */
export function usePresence(live: boolean): Presence | null {
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [idle, setIdle] = useState(false);

  useRTVIClientEvent(
    RTVIEvent.BotStartedSpeaking,
    useCallback(() => {
      setBotSpeaking(true);
      // Playout is the factual boundary a claim may not survive: whatever the
      // server was waiting on, the words are here. contract-wire.md § Claims
      // are retired by a new user turn, bot playout, or explicit `null`.
      setClaim(null);
    }, []),
  );
  useRTVIClientEvent(
    RTVIEvent.BotStoppedSpeaking,
    useCallback(() => setBotSpeaking(false), []),
  );
  useRTVIClientEvent(
    RTVIEvent.UserStartedSpeaking,
    useCallback(() => {
      setUserSpeaking(true);
      setClaim(null);
    }, []),
  );
  useRTVIClientEvent(
    RTVIEvent.UserStoppedSpeaking,
    useCallback(() => setUserSpeaking(false), []),
  );

  // Mute is a Pipecat fact with its own events, not something the server claims
  // — so it arrives here the same way speech does, and needs no vocabulary of
  // its own (pipecat-lifecycle-protocol.md § The silence problem).
  useRTVIClientEvent(
    RTVIEvent.UserMuteStarted,
    useCallback(() => setMuted(true), []),
  );
  useRTVIClientEvent(
    RTVIEvent.UserMuteStopped,
    useCallback(() => setMuted(false), []),
  );

  useRTVIClientEvent(
    RTVIEvent.ServerMessage,
    useCallback((raw: unknown) => {
      const msg = decode(raw);
      if (msg?.cmd !== "claim") return;
      const state = msg.state;
      // Unknown names are dropped rather than shown. A newer server claiming a
      // state this page has never heard of is a version skew, and rendering the
      // string would turn a wire the page cannot read into a state readout that
      // looks authoritative.
      setClaim(typeof state === "string" && CLAIMS.includes(state) ? (state as Claim) : null);
    }, []),
  );

  // Everything above is a latch on the call; a call that ended has none of them.
  useEffect(() => {
    if (live) return;
    setBotSpeaking(false);
    setUserSpeaking(false);
    setMuted(false);
    setClaim(null);
    setIdle(false);
  }, [live]);

  // Quiet only counts while there is nothing else to be. Re-armed from scratch
  // on every change, so a claim arriving eleven seconds into a silence restarts
  // the clock rather than letting it expire underneath the claim.
  const quiet = live && !botSpeaking && !userSpeaking && !muted && !claim;
  useEffect(() => {
    if (!quiet) {
      setIdle(false);
      return;
    }
    const timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [quiet]);

  if (!live) return null;

  // The ladder, in the documented order. Audio truth first: no claim and no
  // microphone event may put a non-speaking word next to an audible one.
  if (botSpeaking) return "SPEAKING";
  if (userSpeaking) return "LISTENING";
  if (muted) return "MUTED";
  // The three claims need no ranking here — one is in flight at a time, and
  // which condition wins when several hold is settled server-side before a
  // message is sent (contract-wire.md).
  if (claim) return claim;
  if (idle) return "IDLE";
  // The floor is listening, not idling. A call where neither party is making a
  // sound is a call waiting on the user, and that is the whole reason the states
  // above this line exist.
  return "LISTENING";
}

/** The `{type: "avatar", ...}` envelope, or `null` for anything else. */
function decode(raw: unknown): { cmd?: unknown; state?: unknown } | null {
  const obj = (raw ?? {}) as Record<string, unknown>;
  // Transports differ on whether the payload arrives wrapped in `data`.
  const inner = obj["data"] as Record<string, unknown> | undefined;
  const msg = inner && "type" in inner ? inner : obj;
  return msg["type"] === "avatar" ? msg : null;
}
