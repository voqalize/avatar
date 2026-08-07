/**
 * `@voqalize/avatar/react` — the React binding.
 *
 *     import { Avatar } from "@voqalize/avatar/react";
 *
 *     <Avatar client={pipecatClient} className="tile" />
 *
 * Peers: `react >= 18` and `@pipecat-ai/client-js`. Everything a non-React
 * host needs is in `@voqalize/avatar/pipecat`; this module adds a mount
 * lifecycle and nothing else.
 */

export { useAvatar, type UseAvatarHandle, type UseAvatarOptions } from "./useAvatar.js";
export { Avatar, type AvatarProps } from "./Avatar.js";

// Re-exported so a React consumer needs one import for the common case.
export { AvatarClient, type AvatarClientOptions } from "./AvatarClient.js";
export {
  isAvatarMessage,
  AVATAR_MESSAGE_TYPE,
  AVATAR_PROTOCOL_VERSION,
  type AvatarCommand,
  type AvatarCue,
  type AvatarCuesCmd,
  type AvatarHintCmd,
  type AvatarInterjectCmd,
  type AvatarPerformAction,
  type AvatarPerformCmd,
  type AvatarServerMessage,
  type AvatarSpeechCmd,
  type AvatarStateCmd,
  type AvatarUnknownCmd,
  type AvatarUserCmd,
} from "./types.js";
