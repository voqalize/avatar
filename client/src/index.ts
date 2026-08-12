/**
 * `@voqalize/avatar` — the avatar as one React component.
 *
 *     import { Avatar } from "@voqalize/avatar";
 *
 *     <Avatar client={pipecatClient} className="avatar-tile" />
 *
 * That is the whole public surface. Put an `AvatarProcessor` in the pipecat
 * pipeline (`pip install voqalize-avatar`), drop this component into the bot's
 * tile, and the face listens, thinks, claims the floor and lipsyncs what the
 * TTS says.
 *
 * The widget underneath is framework-free, and the dispatcher between it and
 * the RTVI data channel is plain TypeScript — but neither is exported. Two
 * consumers wanted a call tile, both are React, and a public API is a promise
 * we have to keep across versions. `docs/removed.md` lists what used to be
 * here and how to get it back if a real third case argues for it.
 *
 * Peers: `react >= 18` and `@pipecat-ai/client-js`.
 */

export { Avatar, type AvatarProps } from "./Avatar.js";
export type { AvatarPresenceState } from "./AvatarClient.js";
