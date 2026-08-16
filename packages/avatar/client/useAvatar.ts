/**
 * useAvatar — mount an avatar into a ref'd element for as long as there is a
 * client to embody, and tear it down after.
 *
 * Internal; `<Avatar>` is the only thing the React entry exports. The whole
 * hook is one effect, because the factory takes the client at construction:
 * there is no separate attach step to keep in its own lifecycle any more.
 */

import { useEffect, useRef } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import {
  createAvatar as createSvgAvatar,
  type AvatarFactory,
  type AvatarOptions,
  type SvgAvatarOptions,
} from "./createAvatar.js";

export interface UseAvatarOptions<O extends AvatarOptions = SvgAvatarOptions> {
  /** The live `PipecatClient`, or `null` before connect. Nothing mounts until
   * this is non-null — an avatar with nothing to embody has nothing to do. */
  client?: PipecatClient | null;
  /** The avatar implementation. Defaults to the bundled SVG faces. */
  create?: AvatarFactory<O>;
  /** Implementation options, forwarded verbatim. Read at mount only. */
  options?: Omit<O, keyof AvatarOptions>;
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
}

export function useAvatar<O extends AvatarOptions = SvgAvatarOptions>(
  { client, create, options }: UseAvatarOptions<O> = {},
): UseAvatarHandle {
  const containerRef = useRef<HTMLDivElement>(null);

  // Latest-options ref, so the mount effect reads the live values without
  // remounting the face every time a caller passes a fresh object literal.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount || !client) return;
    const factory = (create ?? createSvgAvatar) as AvatarFactory<O>;
    // The cast is the seam between "O minus the two we supply" and O. It is
    // sound by construction and TypeScript cannot see through the spread of a
    // generic; the two halves are typed at the boundary the caller touches.
    const instance = factory({ mount, client, ...optionsRef.current } as unknown as O);
    return () => instance.destroy();
    // A new client identity is a new thing to embody, so the avatar is rebuilt
    // rather than re-pointed. Hosts keep one `PipecatClient` across
    // connect/disconnect cycles, so this does not fire on an ordinary
    // reconnect; if yours constructs a fresh client per session, expect the
    // face to remount with it.
  }, [client, create]);

  return { containerRef };
}
