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
 * It talks to `server/` — `POST /api/offer`, proxied in dev by vite.config.ts.
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
  /** Report something the page did that failed — a rejected control request. */
  problem(text: string): void;
  connect(): Promise<void>;
  hangUp(): Promise<void>;
}

export function useCall(): Call {
  const [detail, setDetail] = useState("");

  // Lazily, and exactly once: a second client would mean a second peer
  // connection to a server that runs one call at a time.
  const clientRef = useRef<PipecatClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new PipecatClient({
      transport: new SmallWebRTCTransport(),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onConnected: () => setDetail(""),
        onError: (message) => {
          const data = message?.data as { message?: string } | undefined;
          setDetail(String(data?.message ?? message));
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
    try {
      await client.initDevices();
      await client.connect({ webrtcRequestParams: { endpoint: "/api/offer" } });
    } catch (err) {
      setDetail(err instanceof Error ? err.message : String(err));
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

  return { client, detail, problem, connect, hangUp };
}
