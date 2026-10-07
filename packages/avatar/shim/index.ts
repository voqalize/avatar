/**
 * `@voqalize/avatar` — a talking head that embodies a `PipecatClient`.
 *
 *     import { createAvatar } from "@voqalize/avatar";
 *
 *     const avatar = createAvatar({ mount: el, client: pipecatClient, character: "tara" });
 *     // …
 *     avatar.destroy();
 *
 *     const roster = await listCharacters();   // every character, to choose from
 *
 *     const face = preloadAvatar("tara");      // before the call: build it off screen
 *     await face.ready;                        // optional; createAvatar takes it either way
 *     unloadAvatar(face);                      // the visitor left without calling
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

/**
 * A character, as a page choosing one sees it. The words in `gender`,
 * `ethnicity` and `tags` come from closed lists the runtime keeps, so a filter
 * built from what one call returns matches what the next returns.
 */
export interface CharacterInfo {
  /** What `createAvatar` takes as `character`. */
  readonly name: string;
  /** An image URL: the character at rest. */
  readonly still: string;
  readonly gender: string;
  /** The age the face reads as, in years. */
  readonly age: { readonly min: number; readonly max: number };
  readonly ethnicity: readonly string[];
  /** Dress, hair, jewellery — how the character presents. */
  readonly tags: readonly string[];
  /** Voqalize voice ids that suit this face, best first — `"omnivoice/gauri"`,
   *  for example. Advice only: the avatar never speaks. */
  readonly suggestedVoices: readonly string[];
}

/** A face `preloadAvatar` is building, or has built, ahead of its mount. */
export interface PreloadedAvatar {
  /** The character it is. */
  readonly character: string;
  /** Settles once the face is built, or once it cannot be and the mount will
   * build it the ordinary way. Rejects only for a name that is no character. */
  readonly ready: Promise<void>;
}

interface Runtime {
  mount(request: AvatarOptions & { readonly protocol: number }): AvatarInstance;
  characters?(): readonly CharacterInfo[];
  // Absent from a runtime older than preloading, which makes it a no-op.
  preload?(name: string): Promise<void>;
  unload?(name: string): void;
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
      if (destroyed) return;
      // The runtime moves a preloaded face of this character into the mount,
      // after which it is the avatar's to destroy and no handle's to unload.
      if (held?.character === options.character) held = undefined;
      instance = rt.mount({ ...options, protocol: PROTOCOL });
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

/**
 * Every character the runtime can mount, in a stable order — for a page that
 * lets someone choose one, or filters by what they look like. Loads the runtime
 * if nothing has yet, so the first call waits for it; the list is the
 * runtime's own and cannot be changed.
 */
export async function listCharacters(): Promise<readonly CharacterInfo[]> {
  const rt = await load();
  if (!rt.characters) throw new Error(`[avatar] the runtime at ${RUNTIME_URL} does not list its characters`);
  return rt.characters();
}

// The one face built ahead of its mount. One, not one per character: each
// holds a GPU context and a decoded head, and a page about to call knows
// which character it is about to show.
let held: PreloadedAvatar | undefined;

/**
 * Build a character's face before there is anywhere to show it — the runtime,
 * the character, its GPU context, its shaders and a first frame — so that a
 * `createAvatar` (or `<Avatar>`) of the same character later only moves it onto
 * the page. Call it when the visitor shows they are about to talk: on the page
 * that holds the call button, or on hover over it.
 *
 * Holds one face. The same character again returns the same handle; another
 * character frees the one held and builds the new one. A mount of the
 * character takes the face, and the handle no longer holds anything. Nothing
 * else changes for a mount: one with no preload, or of another character,
 * builds its face as it always has.
 */
export function preloadAvatar(character: string): PreloadedAvatar {
  if (!character) throw new TypeError("preloadAvatar: `character` is required");
  if (held?.character === character) return held;
  if (held) unloadAvatar(held);

  const face: PreloadedAvatar = {
    character,
    ready: load().then(
      (rt) => (held === face ? rt.preload?.(character) : undefined),
      // A runtime that will not load leaves the mount to try again and report
      // it; a preload is never the reason a page cannot call.
      (error) => {
        if (held === face) held = undefined;
        console.error(`[avatar] could not preload the avatar from ${RUNTIME_URL}`, error);
      },
    ).then(
      () => undefined,
      (error: unknown) => {
        if (held === face) held = undefined;
        throw error;
      },
    ),
  };
  held = face;
  return face;
}

/**
 * Free the face `preloadAvatar` built: its GPU context, the decoded character
 * and its textures. For a visitor who leaves without calling, or a page that
 * will not mount it after all. A handle a mount has taken, or that a preload
 * of another character has already replaced, holds nothing, and unloading it
 * does nothing. Safe to call at any time, including before `ready` settles;
 * it then settles without the face being built, or with the build abandoned.
 */
export function unloadAvatar(face: PreloadedAvatar): void {
  if (!face || held !== face) return;
  held = undefined;
  load().then((rt) => rt.unload?.(face.character), () => {});
}
