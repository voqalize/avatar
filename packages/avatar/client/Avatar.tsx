/**
 * Avatar — `createAvatar` as a call tile, and the whole of `@voqalize/avatar/react`.
 *
 *     <Avatar client={session.client} className="avatar-tile" />
 *
 * Three props of its own; everything else is forwarded to the mount `<div>`, so
 * it sizes and styles like the tile it lives in. There is nothing to configure
 * because there is nothing the server does not already say: the
 * `AvatarProcessor` in the pipeline drives the state, the gaze and the mouth.
 *
 * `create` is how you use a different avatar — any module exporting
 * `createAvatar` (docs/design-avatar-interface.md), including a Rive or WebGL
 * one. The component is generic over that implementation's options, so
 * `options` is checked against the factory you passed rather than being a bag:
 *
 *     <Avatar client={c} create={createMascot} options={{ mood: "sly" }} />
 *
 * With no `create` it is the bundled SVG avatar and `options` is
 * `SvgAvatarOptions` minus `mount`/`client`, which the component supplies.
 *
 * The component renders an empty div and a static `role="img"`. It does not
 * label the avatar with its current state: the implementation owns the DOM
 * inside the mount and is the only thing that knows what it is portraying —
 * and a live label would be this package reading back an avatar's internal
 * state, which is the one thing the interface refuses to promise. Pass your
 * own `aria-label` to override.
 */

import type { HTMLAttributes } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { useAvatar } from "./useAvatar.js";
import type { AvatarFactory, AvatarOptions, SvgAvatarOptions } from "./createAvatar.js";

/** An implementation's own options: everything it takes past the two the
 * component supplies itself. */
export type ImplementationOptions<O extends AvatarOptions> = Omit<O, keyof AvatarOptions>;

export type AvatarProps<O extends AvatarOptions = SvgAvatarOptions> =
  Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    /** The live `PipecatClient`, or `null` before connect. Nothing renders
     * until it is non-null. */
    client?: PipecatClient | null;
    /** An avatar implementation. Omit for the bundled SVG faces. */
    create?: AvatarFactory<O>;
    /** Options for that implementation. Read at mount only. */
    options?: ImplementationOptions<O>;
  };

export function Avatar<O extends AvatarOptions = SvgAvatarOptions>({
  client,
  create,
  options,
  ...rest
}: AvatarProps<O>) {
  const { containerRef } = useAvatar<O>({ client, create, options });
  return <div role="img" aria-label="avatar" {...rest} ref={containerRef} />;
}
