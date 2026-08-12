/**
 * Avatar — a call-tile-ready wrapper around the widget, and the package's
 * whole public surface.
 *
 *     <Avatar client={session.client} className="avatar-tile" />
 *
 * Two props of its own; everything else is forwarded to the mount `<div>`, so
 * it sizes and styles like the tile it lives in. There is nothing to configure
 * because there is nothing the server does not already say: the
 * `AvatarProcessor` in the pipeline drives the state, the gaze and the mouth.
 *
 * The widget has no hot-swap-avatar API — `createFace` runs once per mount —
 * so `avatar` is read once, at mount. To switch faces at runtime, remount with
 * a `key` prop:
 *
 *     <Avatar key={name} avatar={name} client={session.client} />
 */

import type { HTMLAttributes } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { useAvatar } from "./useAvatar.js";
import type { AvatarPresenceState } from "./AvatarClient.js";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  /** The live `PipecatClient`, or `null` before connect. */
  client?: PipecatClient | null;
  /** Which face. Omit for the default. Read at mount only — see above. */
  avatar?: string;
  /** Presentation data for surrounding product UI; never affects behavior. */
  onPresenceChange?: (state: AvatarPresenceState) => void;
  /** Active bot remote-audio gain (0…1), useful for a decorative waveform. */
  onRemoteAudioLevel?: (level: number) => void;
}

export function Avatar({ client, avatar, onPresenceChange, onRemoteAudioLevel, ...rest }: AvatarProps) {
  const { containerRef, presence } = useAvatar({ client, avatar, onPresenceChange, onRemoteAudioLevel });
  return <div role="img" aria-label={presence ? `avatar, ${presence.toLowerCase()}` : "avatar"} data-avatar-state={presence ?? undefined} {...rest} ref={containerRef} />;
}
