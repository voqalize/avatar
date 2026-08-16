/**
 * `@voqalize/avatar` — a talking head that embodies a `PipecatClient`.
 *
 *     import { createAvatar } from "@voqalize/avatar";
 *
 *     const avatar = createAvatar({ mount: el, client: pipecatClient });
 *
 * That is the whole public surface. Put an `AvatarProcessor` in the pipecat
 * pipeline (`pip install voqalize-avatar`), mount this in the bot's tile, and
 * the face listens, thinks, claims the floor and lipsyncs what the TTS says.
 *
 * Entry points, and the split is the design rather than packaging taste:
 *
 * - `@voqalize/avatar` — this one. Framework-free. `@pipecat-ai/client-js` is
 *   a type-only import, so even that peer is genuinely optional at runtime.
 *   It carries exactly one drawing: `peep`, the default face.
 * - `@voqalize/avatar/faces/{peep,wren,myna}` — one drawing each. Import the
 *   one you want and pass it as `face`; the others never enter your bundle.
 * - `@voqalize/avatar/react` — `<Avatar>`. Pulls React; nothing here does.
 * - `@voqalize/avatar/internal` — the SVG widget, the behavior catalog and the
 *   viseme clock. **No semver promise**: these move in any minor. They are
 *   exported because an avatar author building on our renderer needs them, not
 *   because they are an interface.
 *
 * To ship your own avatar, publish a module exporting `createAvatar` and import
 * that instead — see `createAvatar.ts` and docs/design-avatar-interface.md.
 */

export { createAvatar } from "./createAvatar.js";
export type {
  AvatarOptions,
  AvatarInstance,
  AvatarFactory,
  SvgAvatarOptions,
  Face,
  FaceTheme,
  Gain,
  HandSide,
} from "./createAvatar.js";
