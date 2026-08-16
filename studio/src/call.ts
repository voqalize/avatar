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
 * This hook owns the client and the log. It does **not** own the notion of
 * "connected": that comes from `usePipecatClientTransportState()` inside the
 * provider, so the button, the mode and the disabled controls all read the same
 * value and cannot drift apart.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { describe, readAvatarMessage } from "./wire";

/** `call` and `error` are the page talking; the other three are the wire. */
export type LogKind = "claim" | "action" | "cues" | "call" | "error";

export interface LogEntry {
  seq: number;
  at: string;
  kind: LogKind;
  text: string;
}

export interface Call {
  readonly client: PipecatClient;
  /** Whatever went wrong last, or "". Cleared by the next connect attempt. */
  readonly detail: string;
  readonly log: readonly LogEntry[];
  clearLog(): void;
  /** Report something the page did that failed — a rejected control request. */
  problem(text: string): void;
  connect(): Promise<void>;
  hangUp(): Promise<void>;
}

/** Enough scrollback to read a burst of cues; not enough to leak a long call. */
const SCROLLBACK = 400;

const clock = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

export function useCall(): Call {
  const [detail, setDetail] = useState("");
  const [log, setLog] = useState<readonly LogEntry[]>([]);
  const seq = useRef(0);

  const append = useCallback((kind: LogKind, text: string) => {
    setLog((prev) => [...prev, { seq: ++seq.current, at: clock(), kind, text }].slice(-SCROLLBACK));
  }, []);

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
        onBotReady: () => append("call", "bot ready"),
        onServerMessage: (raw: unknown) => {
          const cmd = readAvatarMessage(raw);
          // Anything not addressed to the avatar is somebody else's message on
          // a shared channel, and this panel is titled "Wire".
          if (cmd) {
            const kind: LogKind =
              cmd.cmd === "claim" || cmd.cmd === "action" || cmd.cmd === "cues" ? cmd.cmd : "error";
            append(kind, describe(cmd));
          }
        },
        onError: (message) => {
          const data = message?.data as { message?: string } | undefined;
          const text = String(data?.message ?? message);
          setDetail(text);
          append("error", text);
        },
      },
    });
  }
  const client = clientRef.current;

  useEffect(() => () => { void client.disconnect().catch(() => undefined); }, [client]);

  const connect = useCallback(async () => {
    setDetail("");
    try {
      await client.initDevices();
      await client.connect({ webrtcRequestParams: { endpoint: "/api/offer" } });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setDetail(text);
      append("error", text);
      // Back to `disconnected`, or the transport sits in `error` and the connect
      // button — which disables itself in every state but the three it can act
      // on — is stuck. A failed dial should leave you able to dial again.
      await client.disconnect().catch(() => undefined);
    }
  }, [append, client]);

  const hangUp = useCallback(async () => {
    await client.disconnect().catch(() => undefined);
  }, [client]);

  const clearLog = useCallback(() => setLog([]), []);

  // A rejected control request goes in the same log as the wire, on purpose:
  // "the server refused" and "the server sent it and the face ignored it" are
  // the two explanations for a control that appears to do nothing, and reading
  // them in one column in one order is how you tell them apart.
  const problem = useCallback((text: string) => append("error", text), [append]);

  return { client, detail, log, clearLog, problem, connect, hangUp };
}
