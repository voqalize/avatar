/**
 * `createAvatar` — the entire public surface of an avatar.
 *
 *     const avatar = createAvatar({ mount: el, client: pipecatClient });
 *     // …
 *     avatar.destroy();
 *
 * An avatar is an embodiment of a `PipecatClient`. You hand it a mount and a
 * live client; it subscribes and reacts. There is nothing else: no methods to
 * drive it, no callbacks to observe it, no state to read back. Everything it
 * needs to know is already on the wire — Pipecat's factual lifecycle events
 * plus the avatar server-message envelope (docs/contract-wire.md).
 *
 * ## This is also the extension point
 *
 * There is no registry, no loader and no plug-in system. **You add an avatar by
 * publishing a module that exports `createAvatar` with this signature**, and
 * importing yours instead of ours:
 *
 *     import { createAvatar } from "@acme/our-mascot";
 *
 * That is the whole mechanism, and it is deliberate. A registry would make us
 * own resolution, versioning and asset paths for code we have never seen; a
 * renderer interface would make us commit to a second public contract before we
 * know what the second renderer actually needs. An ES module export we get for
 * free from the platform.
 *
 * Everything past `mount` and `client` belongs to the implementation. Ours takes
 * `SvgAvatarOptions`; yours takes whatever it likes, and `AvatarFactory<O>` is
 * generic so the caller still gets your options checked.
 *
 * ## What an implementation owes the caller
 *
 * Only that `destroy()` leaves the mount as it found it and unsubscribes from
 * the client. Not returning to rest, not honouring every action, not even
 * having a mouth — a handless, mouthless avatar that only changes colour is a
 * conforming avatar. The obligations that *matter* are perceptual, not typed,
 * and they live in docs/contract-behavior.md.
 */

import type { PipecatClient } from "@pipecat-ai/client-js";
import { createAvatar as createSvgWidget } from "../src/avatar.js";
import type { Face, FaceTheme, Gain, HandSide } from "../src/avatar.js";
import { peep } from "../src/face-peep.js";
import { AvatarClient } from "./AvatarClient.js";

export type { Face, FaceTheme, Gain, HandSide };

/**
 * What every `createAvatar` takes. Implementations extend it with their own
 * options; the two named here are the only ones the caller can count on.
 */
export interface AvatarOptions {
  /** The element to render into. The implementation owns its contents. */
  readonly mount: HTMLElement;
  /**
   * A live `PipecatClient`. Required, and not nullable: an avatar with nothing
   * to embody has no reason to exist yet. React callers get the forgiving
   * version — `<Avatar>` waits for a non-null client before mounting.
   */
  readonly client: PipecatClient;
}

/** What every `createAvatar` returns. */
export interface AvatarInstance {
  /** Unsubscribe from the client and remove everything from the mount. */
  destroy(): void;
}

/**
 * The shape a third-party avatar module exports, parameterised by its own
 * options so a caller passing them gets them checked. `AvatarFactory` bare is
 * the common denominator — the two options everyone shares.
 */
export type AvatarFactory<O extends AvatarOptions = AvatarOptions> =
  (options: O) => AvatarInstance;

/**
 * Options for the bundled SVG avatars — ours alone; nothing outside this
 * package reads them.
 *
 * `face` is a value, not a name: a name needs a table, and a table needs every
 * face imported to answer any lookup. Import the one you want and the other two
 * never enter your bundle.
 *
 *     import { createAvatar } from "@voqalize/avatar";
 *     import { wren } from "@voqalize/avatar/faces/wren";
 *
 *     createAvatar({ mount, client, face: wren });
 */
export interface SvgAvatarOptions extends AvatarOptions {
  /** Defaults to `peep`, the face this entry point already carries. */
  readonly face?: Face;
  /** Palette for that face. Its keys are the face's own; see `THEME` in its
   * module, and CLAUDE.md on why `peep` has exactly one. */
  readonly theme?: FaceTheme;
  /** Viseme amplitude, 0..2. `1` is as authored. */
  readonly mouthGain?: Gain;
  /** Gesture-clip amplitude, 0..2. */
  readonly gestureGain?: Gain;
  /** Idle/liveness amplitude, 0..2. Low by design — see CLAUDE.md. */
  readonly motionGain?: Gain;
  /** Render the frame-edge hand at all. Default true. */
  readonly hand?: boolean;
  /** `1` puts it on the viewer's right, `-1` the other side. */
  readonly handSide?: HandSide;
}

const GAINS = ["mouthGain", "gestureGain", "motionGain"] as const;

export function createAvatar(options: SvgAvatarOptions): AvatarInstance {
  const { mount, client, face = peep, ...rest } = options;
  if (!mount) throw new TypeError("createAvatar: `mount` is required");
  if (!client) throw new TypeError("createAvatar: `client` is required");
  // The one range TypeScript cannot state, checked where it is cheapest to fix:
  // at construction, by the caller who typed the number.
  for (const key of GAINS) {
    const g = rest[key];
    if (g === undefined) continue;
    if (!Number.isFinite(g) || g < 0 || g > 2) {
      throw new RangeError(`createAvatar: \`${key}\` must be 0..2, got ${String(g)}`);
    }
  }

  const widget = createSvgWidget({ mount, face, ...rest });
  const driver = new AvatarClient(widget);
  const detach = driver.attach(client);

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach();
      driver.destroy();
      widget.destroy();
    },
  };
}
