/**
 * `@voqalize/avatar/react` — the avatar as one component.
 *
 *     import { Avatar } from "@voqalize/avatar/react";
 *
 *     <Avatar client={session.client} character="tara" className="avatar-tile" />
 *
 * Separate from the main entry so that `createAvatar` costs nothing to a caller
 * who is not on React. Everything but the avatar's own props is forwarded to
 * the mount `<div>`, so it sizes and styles like the tile it lives in.
 */

import { useEffect, useRef, type HTMLAttributes } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { createAvatar, type Gain } from "./index.js";

export type AvatarProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** The live `PipecatClient`, or `null` before connect. Nothing mounts until
   * it is non-null. */
  client?: PipecatClient | null;
  /** Which character, by name. */
  character: string;
  /** Read at mount only. */
  mouthGain?: Gain;
  /** Read at mount only. */
  gestureGain?: Gain;
  /** Read at mount only. */
  motionGain?: Gain;
};

export function Avatar({ client, character, mouthGain, gestureGain, motionGain, ...rest }: AvatarProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The gains are read at mount through a ref, so a fresh literal on every
  // render does not rebuild the face.
  const gains = useRef({ mouthGain, gestureGain, motionGain });
  gains.current = { mouthGain, gestureGain, motionGain };

  useEffect(() => {
    const mount = ref.current;
    if (!mount || !client) return;
    const avatar = createAvatar({ mount, client, character, ...gains.current });
    return () => avatar.destroy();
    // A new client or character is a new thing to embody, so the avatar is
    // rebuilt rather than re-pointed.
  }, [client, character]);

  return <div role="img" aria-label="avatar" {...rest} ref={ref} />;
}
