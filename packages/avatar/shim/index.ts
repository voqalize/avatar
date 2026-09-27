/**
 * `@voqalize/avatar` — a talking head that embodies a `PipecatClient`.
 *
 *     import { createAvatar } from "@voqalize/avatar";
 *
 *     const avatar = createAvatar({ mount: el, client: pipecatClient, character: "tara" });
 *     // …
 *     avatar.destroy();
 *
 * This package is the loader and nothing else. The avatar itself — the
 * characters, the renderer and everything that reads the call — is the
 * Voqalize avatar runtime, which this module imports from
 * `avatar.voqalize.com` at the version it was released with and which is
 * licensed separately. `createAvatar` returns at once; the face appears when
 * the runtime and the character have arrived.
 *
 * A page with a Content-Security-Policy needs `https://avatar.voqalize.com` in
 * `script-src` (the runtime), `connect-src` (the character it fetches) and
 * `img-src` (the camera-off still, where there is no WebGL 2), and `blob:` in
 * `connect-src` (the character's textures are decoded from blob URLs;
 * `img-src` too on Safari before 17 and Firefox before 98).
 */

import type { PipecatClient } from "@pipecat-ai/client-js";
import { PROTOCOL, RUNTIME_URL } from "./pin.js";

/** Amplitude, 0..2. `1` is as authored. */
export type Gain = number;

export interface AvatarOptions {
  /** The element to render into. The avatar owns its contents. */
  readonly mount: HTMLElement;
  /** The live `PipecatClient` the avatar embodies. */
  readonly client: PipecatClient;
  /** Which character, by name — `"tara"`, for example. */
  readonly character: string;
  /** Mouth movement. */
  readonly mouthGain?: Gain;
  /** Nods and other gestures. */
  readonly gestureGain?: Gain;
  /** Idle motion. */
  readonly motionGain?: Gain;
}

export interface AvatarInstance {
  /** Stop embodying the client and empty the mount. Safe to call at any time,
   * including before the avatar has appeared. */
  destroy(): void;
}

interface Runtime {
  mount(request: AvatarOptions & { readonly protocol: number }): AvatarInstance;
}

let runtime: Promise<Runtime> | undefined;

function load(): Promise<Runtime> {
  // One import per page, however many avatars mount; a failure is forgotten so
  // the next mount tries again rather than inheriting a dead promise.
  runtime ??= import(/* @vite-ignore */ /* webpackIgnore: true */ RUNTIME_URL).catch((error) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}

export function createAvatar(options: AvatarOptions): AvatarInstance {
  if (!options?.mount) throw new TypeError("createAvatar: `mount` is required");
  if (!options.client) throw new TypeError("createAvatar: `client` is required");
  if (!options.character) throw new TypeError("createAvatar: `character` is required");

  let instance: AvatarInstance | undefined;
  let destroyed = false;
  load()
    .then((rt) => {
      if (!destroyed) instance = rt.mount({ ...options, protocol: PROTOCOL });
    })
    .catch((error) => console.error(`[avatar] could not start the avatar from ${RUNTIME_URL}`, error));

  return {
    destroy() {
      destroyed = true;
      instance?.destroy();
      instance = undefined;
    },
  };
}
