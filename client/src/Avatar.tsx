/**
 * Avatar — a call-tile-ready wrapper around the widget.
 *
 * Thin by design: `useAvatar` does the work; this is the div it mounts into
 * plus prop plumbing.
 *
 *     <Avatar client={session.client} className="avatar-tile" />
 *
 * The widget has no hot-swap-avatar API — `createFace` runs once per mount —
 * so `avatar`/`theme`/`mouthGain`/`gestureGain` are read once, at mount. To
 * switch avatars at runtime, remount with a `key` prop:
 *
 *     <Avatar key={name} avatar={name} client={session.client} />
 */

import type { CSSProperties } from "react";
import type { UseAvatarOptions } from "./useAvatar.js";
import { useAvatar } from "./useAvatar.js";

export interface AvatarProps extends UseAvatarOptions {
  className?: string;
  style?: CSSProperties;
  /** Forwarded to the mount `<div>`. */
  "aria-label"?: string;
}

export function Avatar({ className, style, "aria-label": ariaLabel, ...options }: AvatarProps) {
  const { containerRef } = useAvatar(options);
  return (
    <div
      ref={containerRef}
      className={className}
      style={style}
      aria-label={ariaLabel ?? "avatar"}
      role="img"
    />
  );
}
