/**
 * useAvatar — mount the widget, wire it to a live session, dispatch its
 * server-messages, and clean up.
 *
 * Options are read through a ref so the effect doesn't re-subscribe on every
 * render. Split in two effects: mounting the widget happens once (an avatar or
 * theme swap remounts by design — see the note in the effect); attaching to
 * the pipecat client re-runs whenever the client identity changes (a session
 * reconnect mints a new one) or once the widget instance becomes available.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { createAvatar, type AvatarApi, type CreateAvatarOptions } from "../../src/avatar.js";
import { AvatarClient, type AvatarClientOptions } from "./AvatarClient.js";

export interface UseAvatarOptions extends AvatarClientOptions {
  /** Name from `AVATAR_NAMES`. Omit for the widget's own `DEFAULT_AVATAR`. */
  avatar?: string;
  theme?: CreateAvatarOptions["theme"];
  /** Articulation gains — see docs/contract-protocol.md § Events, gains, introspection. */
  mouthGain?: number;
  gestureGain?: number;
  /** The live `PipecatClient` to dispatch server-messages from, or `null`
   * before connect. `useAvatar` (dis)connects the subscription as this
   * changes; it does not create or own the client. */
  client?: PipecatClient | null;
}

/**
 * The mount ref's type, written out rather than named as React's `RefObject`.
 *
 * React 18 and 19 declare that alias with different type arguments — 18's
 * `useRef<T>(null)` yields `RefObject<T>`, 19's yields `RefObject<T | null>` —
 * and because both are the *same alias*, TypeScript compares them by variance
 * and rejects whichever one we didn't pick. An anonymous shape forces a
 * structural comparison instead, which both versions satisfy, and which the
 * `ref` prop accepts on both. This is the only place the 18-vs-19 split shows
 * up in the binding; keep it that way.
 */
export type AvatarMountRef = { current: HTMLDivElement | null };

export interface UseAvatarHandle {
  /** Attach to the mount element: `<div ref={containerRef} />`. */
  containerRef: AvatarMountRef;
  /** The live widget instance once mounted, else `null`. */
  avatar: AvatarApi | null;
  /** The dispatcher wrapping `avatar` — `null` until mounted. Exposed for
   * tests and telemetry (`turnCtx`, `turnCues`) and for manual dispatch. */
  client: AvatarClient | null;
  /** Dispatch one avatar command by hand — e.g. from a dev-tools console, or
   * from a transport that isn't a `PipecatClient`. No-ops before mount. */
  dispatch: (msg: unknown) => void;
}

export function useAvatar(options: UseAvatarOptions = {}): UseAvatarHandle {
  const containerRef = useRef<HTMLDivElement>(null);
  const [avatar, setAvatar] = useState<AvatarApi | null>(null);
  const avatarClientRef = useRef<AvatarClient | null>(null);

  // Latest-options ref, so the mount effect (which runs once) still reads live
  // callback props without re-subscribing.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;
    const instance = createAvatar({
      mount,
      avatar: optionsRef.current.avatar,
      theme: optionsRef.current.theme,
      mouthGain: optionsRef.current.mouthGain,
      gestureGain: optionsRef.current.gestureGain,
    });
    const wrapper = new AvatarClient(instance, {
      onHint: (kind, msg) => optionsRef.current.onHint?.(kind, msg),
      onUnknownCmd: (msg) => optionsRef.current.onUnknownCmd?.(msg),
      onError: (err, msg) => optionsRef.current.onError?.(err, msg),
      onSpeakingDrift: (info) => optionsRef.current.onSpeakingDrift?.(info),
      accept: optionsRef.current.accept,
      now: optionsRef.current.now,
    });
    avatarClientRef.current = wrapper;
    setAvatar(instance);

    return () => {
      instance.destroy();
      avatarClientRef.current = null;
      setAvatar(null);
    };
    // Mount once. `avatar`/`theme`/the gains are read at mount time only — the
    // widget has no hot-swap-avatar API (`createFace` runs once per mount), so
    // changing them re-renders nothing here by design; a caller that needs a
    // different avatar remounts with a `key` prop (see the component's doc).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const wrapper = avatarClientRef.current;
    const pipecatClient = options.client;
    if (!wrapper || !pipecatClient) return;
    return wrapper.attach(pipecatClient);
    // Re-subscribe when the widget mounts or the session's client changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatar, options.client]);

  const dispatch = useCallback((msg: unknown) => {
    avatarClientRef.current?.dispatch(msg);
  }, []);

  return { containerRef, avatar, client: avatarClientRef.current, dispatch };
}
