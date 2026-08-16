/**
 * `@voqalize/avatar/react` — the avatar as one component.
 *
 *     import { Avatar } from "@voqalize/avatar/react";
 *
 *     <Avatar client={session.client} className="avatar-tile" />
 *
 * Separate from the main entry so that `createAvatar` costs nothing to a
 * caller who is not on React — React is an optional peer, and a barrel that
 * re-exported this would make it a hard one.
 */

export { Avatar, type AvatarProps } from "./Avatar.js";
