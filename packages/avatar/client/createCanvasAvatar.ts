/** Shared private constructor for the code-authored canvas avatars. */

import type { PipecatClient } from '@pipecat-ai/client-js';
import { createAvatar as createMixer, STATES } from '../src/avatar.js';
import type { Gain } from '../src/avatar.js';
import { createCanvasRig } from '../src/canvas/create-rig.js';
import { AvatarClient } from './AvatarClient.js';
import type { AvatarInstance, AvatarOptions } from './createAvatar.js';

export interface CanvasAvatarOptions extends AvatarOptions {
  /** Viseme amplitude, 0..2. `1` is as authored. */
  readonly mouthGain?: Gain;
  /** Gesture-clip amplitude, 0..2. */
  readonly gestureGain?: Gain;
  /** Idle/liveness amplitude, 0..2. */
  readonly motionGain?: Gain;
}

/** @deprecated Use `CanvasAvatarOptions`; kept for the original entry points. */
export type InterviewerAvatarOptions = CanvasAvatarOptions;

interface CanvasAvatarConfig {
  readonly rigUrl: URL;
  readonly images: Readonly<Record<string, URL>>;
  readonly face: () => Promise<unknown>;
  readonly label: string;
}

const GAINS = ['mouthGain', 'gestureGain', 'motionGain'] as const;
const PRESENCE_FILTERS: Readonly<Record<string, string>> = {
  DEGRADED: String(STATES.DEGRADED.filter ?? ''),
  OFFLINE: String(STATES.OFFLINE.filter ?? ''),
};

export function createCanvasAvatar(
  options: CanvasAvatarOptions,
  config: CanvasAvatarConfig,
): AvatarInstance {
  const { mount, client, ...gains } = options;
  if (!mount) throw new TypeError('createAvatar: `mount` is required');
  if (!client) throw new TypeError('createAvatar: `client` is required');
  for (const key of GAINS) {
    const gain = gains[key];
    if (gain === undefined) continue;
    if (!Number.isFinite(gain) || gain < 0 || gain > 2) {
      throw new RangeError(`createAvatar: \`${key}\` must be 0..2, got ${String(gain)}`);
    }
  }

  const canvas = createCanvasRig({
    url: config.rigUrl,
    images: config.images,
    face: config.face,
    label: config.label,
  });
  const widget = createMixer({ mount, rig: canvas.factory, ...gains });
  const driver = new AvatarClient(widget, {
    onPresenceChange: (state) => canvas.setPresenceFilter(PRESENCE_FILTERS[state] ?? ''),
  });
  const detach = driver.attach(client as PipecatClient);

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
