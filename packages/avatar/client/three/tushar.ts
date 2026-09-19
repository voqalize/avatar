/**
 * tushar — the second 3-D character, and deliberately a copy of `tara.ts`.
 *
 * His GLB is tara's scripts run with his landmarks and atlas layout in place of
 * hers (`characters/tushar/`, whose README has the provenance and the commands),
 * so the rig, the mixer, the sequences and her tuning are all hers, unmodified;
 * the one seam is `TaraRigOptions.url`. What turns out to be hers rather than
 * general is marked TARA-SPECIFIC where it lives, and generalised only once a
 * third character agrees.
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

  const rigOptions: TaraRigOptions = { onReady, url: ASSETS.tushar };
  // TARA-SPECIFIC, kept on purpose: `TARA_TUNING` (her mouth and motion gains)
  // is the first thing to question if he reads wrong in a call.
  const widget = createSvgAvatar({
    mount, rig: createTaraRig, rigOptions, hand: false,
    sequences: BLENDER_SEQUENCES, actions: BLENDER_ACTIONS, ...TARA_TUNING,
    headHold: headHold("tushar"), ...gains,
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
