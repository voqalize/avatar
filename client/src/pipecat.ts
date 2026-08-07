/**
 * `@voqalize/avatar/pipecat` — drive the widget from a pipecat session.
 *
 * Framework-free: everything here is plain TypeScript over the `AvatarApi` the
 * root export returns. `AvatarClient` is the whole surface — construct it
 * around a mounted widget and either `attach()` it to a live `PipecatClient`
 * or feed it messages yourself with `dispatch()`.
 *
 *     import { createAvatar } from "@voqalize/avatar";
 *     import { AvatarClient } from "@voqalize/avatar/pipecat";
 *
 *     const avatar = createAvatar({ mount: "#tile" });
 *     const detach = new AvatarClient(avatar).attach(pipecatClient);
 *
 * `@pipecat-ai/client-js` is a peer dependency of this subpath only — the root
 * export has no dependencies at all, and a host that carries avatar commands
 * over its own transport can import this module and never call `attach()`.
 */

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
