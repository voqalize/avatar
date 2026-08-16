/**
 * The call — one real `PipecatClient` on a real `SmallWebRTCTransport`.
 *
 * Studio used to fabricate this: an event bus, a virtual clock, and four
 * hand-written traces standing in for a server. It reviewed the trace fixtures
 * faithfully and the wire not at all, because nothing in the loop had ever been
 * across a network. What the avatar embodies is a live client, so that is what
 * this hands it.
 *
 * The client is constructed once and lives for the life of the page, not for
 * the life of a call. `createAvatar` binds to it at mount and the face has an
 * offline and a listening reading of its own; rebuilding either on connect
 * would throw those away and would also mean the avatar you were watching is
 * not the avatar you configured.
 *
 * It talks to `apps/server/` — `POST /api/offer`, proxied in dev by vite.config.ts.
 * There is no URL field and no token field: the one server this speaks to needs
 * no credential, and a box for one would advertise a configuration surface the
 * library does not have.
 *
 * This hook owns the client. It does **not** own the notion of "connected":
 * that comes from `usePipecatClientTransportState()` inside the provider, so
 * the button, the mode and the disabled controls all read the same value and
 * cannot drift apart.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";

export interface Call {
  readonly client: PipecatClient;
  /** Whatever went wrong last, or "". Cleared by the next connect attempt. */
  readonly detail: string;
  /**
   * The last failed dial, as the raw text the transport gave — often "", because
   * a refused connection is frequently an error object with nothing readable on
   * it. `null` means no dial has failed. The distinction matters: `""` still
   * has to raise the "is `apps/server/` running?" message, and it used to render as
   * the literal word `undefined` in a red banner, which told nobody anything.
   */
  readonly unreachable: string | null;
  /** Report something the page did that failed — a rejected control request. */
  problem(text: string): void;
  connect(): Promise<void>;
  hangUp(): Promise<void>;
}

/**
 * Where `apps/server/server.py` binds — the target `vite.config.ts` proxies `/api`
 * to, baked in at build time so the "start the server" message names the port
 * this page is really talking to rather than a plausible one.
 */
export const SERVER_URL: string = import.meta.env.VITE_AVATAR_SERVER_URL;

/**
 * Something a person can read, or `""` — never `undefined`, never
 * `[object Object]`.
 *
 * `String(err)` is the trap: an RTVI error callback fired with no argument
 * stringifies to the word "undefined", and one carrying a payload with no
 * `message` stringifies to "[object Object]". Both were rendered verbatim in a
 * red banner. The caller decides what to say when this returns nothing; this
 * only promises never to invent text that looks like a diagnosis.
 */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return err.message.trim();
  if (err && typeof err === "object") {
    const obj = err as { message?: unknown; data?: { message?: unknown } };
    if (typeof obj.data?.message === "string") return obj.data.message.trim();
    if (typeof obj.message === "string") return obj.message.trim();
  }
  return "";
}

export function useCall(): Call {
  const [detail, setDetail] = useState("");
  const [unreachable, setUnreachable] = useState<string | null>(null);

  // Lazily, and exactly once: a second client would mean a second peer
  // connection to a server that runs one call at a time.
  const clientRef = useRef<PipecatClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new PipecatClient({
      transport: new SmallWebRTCTransport(),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onConnected: () => {
          setDetail("");
          setUnreachable(null);
        },
        onError: (message) => {
          // The whole object to the console, a sentence to the page. Most of
          // what arrives here has no readable text on it at all, and printing
          // its stringification was worse than printing nothing.
          console.error("[studio] pipecat client error", message);
          const text = errorText(message);
          setDetail(text || "The call reported an error with no message — the full object is in the console.");
        },
      },
    });
  }
  const client = clientRef.current;

  // Enumerate microphones before anyone dials, because the device picker sits
  // under the avatar and is meant to be usable *first* — "which mic is this
  // going to use" is a question you want answered before the call, not after
  // discovering it took the wrong one. This is what prompts for permission.
  useEffect(() => {
    void client.initDevices().catch(() => undefined);
    return () => {
      void client.disconnect().catch(() => undefined);
    };
  }, [client]);

  const connect = useCallback(async () => {
    setDetail("");
    setUnreachable(null);
    try {
      await client.initDevices();
      await client.connect({ webrtcRequestParams: { endpoint: "/api/offer" } });
    } catch (err) {
      // A failed dial is nearly always one thing — nothing is listening on
      // 7860 — and the useful answer is the command that fixes it, not the
      // exception. So the exception goes to the console and the button gets a
      // sentence (`Stage.tsx`); this only records that it happened, and with
      // what text, which may legitimately be none.
      console.error("[studio] connect failed", err);
      setUnreachable(errorText(err));
      // Back to `disconnected`, or the transport sits in `error` and the connect
      // button — which disables itself in every state but the three it can act
      // on — is stuck. A failed dial should leave you able to dial again.
      await client.disconnect().catch(() => undefined);
    }
  }, [client]);

  const hangUp = useCallback(async () => {
    await client.disconnect().catch(() => undefined);
  }, [client]);

  const problem = useCallback((text: string) => setDetail(text), []);

  return { client, detail, unreachable, problem, connect, hangUp };
}
