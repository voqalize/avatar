/**
 * tara — the first 3-D character, as a complete `createAvatar` module.
 *
 * Structurally this is the canvas avatars' shape, one layer down: the mixer
 * (`@voqalize/avatar/internal`) does states, layers, gaze, idle, blinks, clips
 * and per-channel smoothing exactly as it does for every SVG face, and the only
 * thing tara replaces is the renderer at the end of it. That is the whole
 * argument for authoring her morph targets under the library's pose-channel
 * names: nothing above this line knows there is a GPU involved, and every clip,
 * viseme and co-articulation rule the SVG faces have works here unmodified.
 *
 * The Three.js import lives behind this module rather than in the barrel so an
 * SVG or Canvas consumer never downloads it.
 */

import type { PipecatClient } from "@pipecat-ai/client-js";
import { AvatarClient, createSvgAvatar } from "../internal.js";
import { BLENDER_ACTIONS, BLENDER_SEQUENCES, BLENDER_SUPPORTS } from "./sequences.js";
import { TARA_GLB } from "./tara-asset.js";
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

  const rigOptions: TaraRigOptions = { onReady, url: TARA_GLB };
  // `hand: false` disables the bundled SVG hand renderer only; the semantic
  // hand frame still reaches the rig, which ignores it — tara has no arms, and
  // that is the library's oldest standing constraint rather than an omission.
  // `sequences` is what a server can address on *this* avatar beyond the two
  // ids every avatar owes it — the three nod types the listening research
  // separates, and a head shake sized for a rig whose pose unit is a degree.
  // The wire's action id is open, so nothing here needed promoting; a server
  // that does not know tara is mounted sends `ACKNOWLEDGE` and is never wrong.
  // `actions` is the other half: her own shape for an id the mixer already has,
  // whose shared keys land outside what it means on a head that turns in degrees.
  const widget = createSvgAvatar({
    mount, rig: createTaraRig, rigOptions, hand: false,
    sequences: BLENDER_SEQUENCES, actions: BLENDER_ACTIONS, ...TARA_TUNING,
    headHold: headHold("tara"), ...gains,
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
