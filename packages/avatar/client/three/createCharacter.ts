/**
 * `createCharacter` — the Blender characters' entry point, and the other end of
 * the fork agreed on 2026-09-17 (*"Aligned that we fork"*).
 *
 * There are two `createAvatar` implementations in this package now, not one
 * with a branch in it. `client/createAvatar.ts` mounts a drawing: a `Face`
 * record, a theme, the frame-edge hand. This one mounts a compiled head: a GLB
 * url, the shared rig, the house performance. They are separate because almost
 * every option the second one passes exists to *undo* something the first one
 * assumes — no hand, no theme, clips whose keys are degrees rather than ink —
 * and threading one more per-avatar option through a shared entry point is the
 * smell rather than the fix.
 *
 * **What is not forked is the mixer.** Both entry points resolve their options
 * and hand them to the same `createSvgAvatar`, which still does states, layers,
 * gaze, idle, blinks, clips and per-channel smoothing for every face in the
 * package. Forking *that* would give two copies of the smoothing law, and the
 * smoothing law is the thing a clip's keyframes are authored against
 * (docs/internal-mixer.md § Smoothing) — two copies of it drift, and the drift
 * is invisible until a nod reads wrong on one character only.
 *
 * A character module is therefore its GLB and its name:
 *
 *     export const supports = BLENDER_SUPPORTS;
 *     export const createAvatar = character("tara", TARA_GLB);
 *
 * and everything else about how a Blender character is driven is here, once.
 */

import type { PipecatClient } from "@pipecat-ai/client-js";
import { AvatarClient, createSvgAvatar } from "../internal.js";
import type { AvatarFactory, AvatarInstance, AvatarOptions } from "../createAvatar.js";
import { BLENDER_ACTIONS, BLENDER_SEQUENCES } from "./sequences.js";
import { headHold } from "./holds.js";
import { createCharacterRig, CHARACTER_TUNING } from "./character-rig.js";
import type { CharacterRigOptions } from "./character-rig.js";

/**
 * What every Blender character takes — the two options every avatar shares,
 * plus the three gains.
 *
 * There is no `face`, no `theme` and no `hand`: a compiled character is one
 * drawing with one palette baked into its atlas, and it has no arms. There is
 * no `url` either, because the character *is* the module you imported.
 */
export interface CharacterAvatarOptions extends AvatarOptions {
  /** Viseme amplitude, 0..2. `1` is as authored. */
  readonly mouthGain?: number;
  /** Gesture-clip amplitude, 0..2. */
  readonly gestureGain?: number;
  /** Idle/liveness amplitude, 0..2. */
  readonly motionGain?: number;
  /** Fires when the GLB is in the scene — for a capture tool, not a consumer. */
  readonly onReady?: () => void;
}

export type { AvatarInstance };

/**
 * One Blender character's `createAvatar`, bound to its name and its mesh.
 *
 * `name` is not a lookup key — nothing resolves a character by it and there is
 * no table to miss. It selects this face's row in `motion-limits.json`, which
 * is the one per-character fact that is neither in the GLB nor in the rig:
 * the angles a person read off the face by eye, which no build can derive
 * (`holds.ts`).
 */
export function character(name: Parameters<typeof headHold>[0], url: string):
    AvatarFactory<CharacterAvatarOptions> {
  const hold = headHold(name);
  return function createAvatar(options: CharacterAvatarOptions): AvatarInstance {
    const { mount, client, onReady, ...gains } = options;
    if (!mount) throw new TypeError("createAvatar: `mount` is required");
    if (!client) throw new TypeError("createAvatar: `client` is required");

    const rigOptions: CharacterRigOptions = { onReady, url };
    // `hand: false` disables the bundled SVG hand renderer only; the semantic
    // hand frame still reaches the rig, which ignores it — these characters
    // have no arms, and that is the library's oldest standing constraint
    // rather than an omission.
    //
    // `sequences` is what a server can address on a Blender character beyond
    // the two ids every avatar owes it — the three nod types the listening
    // research separates, and a head shake sized for a rig whose pose unit is
    // a degree. The wire's action id is open, so nothing here needed
    // promoting: a server that does not know which face is mounted sends
    // `ACKNOWLEDGE` and is never wrong. `actions` is the other half, the
    // Blender shape for an id the mixer already has, whose shared keys land
    // outside what they mean on a head that turns in degrees.
    const widget = createSvgAvatar({
      mount, rig: createCharacterRig, rigOptions, hand: false,
      sequences: BLENDER_SEQUENCES, actions: BLENDER_ACTIONS, ...CHARACTER_TUNING,
      headHold: hold, ...gains,
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
  };
}
