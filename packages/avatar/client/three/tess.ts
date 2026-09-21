/**
 * tess — American, and like `tushar.ts` and `tanya.ts` a copy of `tara.ts`.
 *
 * Her GLB is tara's scripts run with her landmarks in place of tara's
 * (`characters/tess/`, whose README has the provenance and the commands), so
 * the rig, the mixer, the sequences and her tuning are all hers, unmodified;
 * the one seam is `TaraRigOptions.url`.
 *
 * She is back inside tara's atlas window — her hair is drawn into a low tail
 * that clears both ears and reaches |u| 0.492 against a window that stops at
 * 0.64 — so unlike tanya she needs no `face_texture.py` of her own, and her
 * `Hair` shell gives up no roll: nothing of hers hangs past the jaw to lag.
 *
 * Her head angles have not been read off her yet. `motion-limits.json` says so
 * rather than guessing, and `headHold` gives her the tightest budget any face
 * is still vouched for until the owner drives her.
 */

import type { PipecatClient } from "@pipecat-ai/client-js";
import { AvatarClient, createSvgAvatar } from "../internal.js";
import { TESS_GLB } from "./tess-asset.js";
import { BLENDER_ACTIONS, BLENDER_SEQUENCES, BLENDER_SUPPORTS } from "./sequences.js";
import { headHold } from "./holds.js";
import { createTaraRig, TARA_TUNING } from "./tara-rig.js";
import type { TaraRigOptions } from "./tara-rig.js";

export interface AvatarOptions {
  readonly mount: HTMLElement;
  readonly client: PipecatClient;
  /** Viseme amplitude, 0..2. `1` is as authored. */
  readonly mouthGain?: number;
  /** Gesture-clip amplitude, 0..2. */
  readonly gestureGain?: number;
  /** Idle/liveness amplitude, 0..2. */
  readonly motionGain?: number;
  /** Fires when the GLB is in the scene — for a capture tool, not a consumer. */
  readonly onReady?: () => void;
}

export interface AvatarInstance { destroy(): void; }

/** The optional driving-UI declaration; one list for every character built on
 *  this rig (`sequences.ts`), because they are one rig. */
export const supports = BLENDER_SUPPORTS;

export function createAvatar(options: AvatarOptions): AvatarInstance {
  const { mount, client, onReady, ...gains } = options;
  if (!mount) throw new TypeError("createAvatar: `mount` is required");
  if (!client) throw new TypeError("createAvatar: `client` is required");

  const rigOptions: TaraRigOptions = { onReady, url: TESS_GLB };
  // TARA-SPECIFIC, kept on purpose: `TARA_TUNING` (her mouth and motion gains)
  // is the first thing to question if she reads wrong in a call.
  const widget = createSvgAvatar({
    mount, rig: createTaraRig, rigOptions, hand: false,
    sequences: BLENDER_SEQUENCES, actions: BLENDER_ACTIONS, ...TARA_TUNING,
    headHold: headHold("tess"), ...gains,
  });
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
