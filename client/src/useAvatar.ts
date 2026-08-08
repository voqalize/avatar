/**
 * useAvatar — mount the widget, wire it to a live session, dispatch its
 * server-messages, and clean up.
 *
 * Internal: `<Avatar>` is the only thing the package exports. It is a separate
 * module anyway because the two lifecycles genuinely differ — mounting the
 * widget happens once (an avatar swap remounts by design; see the note in the
 * effect), while attaching to the pipecat client re-runs whenever the client
 * identity changes, which a session reconnect makes it do.
 */

import { useEffect, useRef, useState } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { createAvatar, type AvatarApi } from "../../src/avatar.js";
import { AvatarClient } from "./AvatarClient.js";

export interface UseAvatarOptions {
  /** Which face. Omit for the widget's own default. */
  avatar?: string;
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
}

export function useAvatar(options: UseAvatarOptions = {}): UseAvatarHandle {
  const containerRef = useRef<HTMLDivElement>(null);
  const [avatar, setAvatar] = useState<AvatarApi | null>(null);
  const avatarClientRef = useRef<AvatarClient | null>(null);

  // Latest-options ref, so the mount effect (which runs once) still reads the
  // live props without re-subscribing.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;
    const instance = createAvatar({ mount, avatar: optionsRef.current.avatar });
    avatarClientRef.current = new AvatarClient(instance);
    setAvatar(instance);

    return () => {
      instance.destroy();
      avatarClientRef.current = null;
      setAvatar(null);
    };
    // Mount once. `avatar` is read at mount time only — the widget has no
    // hot-swap-avatar API (`createFace` runs once per mount), so changing it
    // re-renders nothing here by design; a caller that needs a different face
    // remounts with a `key` prop (see the component's doc).
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

  return { containerRef, avatar };
}
