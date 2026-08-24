import type { AvatarRigFactory } from '../rig.js';

export interface CanvasRigConfig {
  url: URL;
  images: Readonly<Record<string, URL>>;
  face: () => Promise<unknown>;
  label: string;
}

export interface CanvasRig {
  readonly factory: AvatarRigFactory;
  setPresenceFilter(filter: string): void;
}

export function createCanvasRig(config: CanvasRigConfig): CanvasRig;
