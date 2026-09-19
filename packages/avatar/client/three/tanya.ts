/**
 * tanya — the third 3-D character, and like `tushar.ts` a copy of `tara.ts`.
 *
 * Her GLB is tara's scripts run with her landmarks and atlas layout in place of
 * hers (`characters/tanya/`, whose README has the provenance and the commands),
 * so the rig, the mixer, the sequences and her tuning are all hers, unmodified;
 * the one seam is `TaraRigOptions.url`.
 *
 * She is the first character whose atlas is not tara's window. Her hair is the
 * silhouette down past the jaw, out to |u| 0.761 where tara's window stops at
 * 0.64, so `characters/tanya/face_texture.py` widens it to 1408x1568 at the same
 * 800 pixels per face height. That is a fact about the asset and costs this file
 * nothing — the rig reads the window from the GLB.
 */

import type { PipecatClient } from "@pipecat-ai/client-js";
import { AvatarClient, createSvgAvatar } from "../internal.js";
import { ASSETS } from "./assets.js";
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

/** The optional driving-UI declaration; one list for all three characters
 *  (`sequences.ts`), because they are one rig. */
export const supports = BLENDER_SUPPORTS;

export function createAvatar(options: AvatarOptions): AvatarInstance {
  const { mount, client, onReady, ...gains } = options;
  if (!mount) throw new TypeError("createAvatar: `mount` is required");
  if (!client) throw new TypeError("createAvatar: `client` is required");

  const rigOptions: TaraRigOptions = { onReady, url: ASSETS.tanya };
  // TARA-SPECIFIC, kept on purpose: `TARA_TUNING` (her mouth and motion gains)
  // is the first thing to question if she reads wrong in a call.
  const widget = createSvgAvatar({
    mount, rig: createTaraRig, rigOptions, hand: false,
    sequences: BLENDER_SEQUENCES, actions: BLENDER_ACTIONS, ...TARA_TUNING,
    headHold: headHold("tanya"), ...gains,
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
