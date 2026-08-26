// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAvatar as createArjun } from '../client/arjun.js';
import { createAvatar as createMeera } from '../client/meera.js';
import { createAvatar as createVikram } from '../client/vikram.js';
import { createAvatar as createIshita } from '../client/ishita.js';
import { createAvatar as createKabir } from '../client/kabir.js';
import { createAvatar as createNaina } from '../client/naina.js';
import { createAvatar as createMale } from '../client/interviewer-male.js';
import { createAvatar as createFemale } from '../client/interviewer-female.js';
import { createAvatar as createProfessionalMaleA } from '../client/professional-male-a.js';
import { createAvatar as createProfessionalFemaleA } from '../client/professional-female-a.js';
import { createAvatar as createProfessionalMaleB } from '../client/professional-male-b.js';
import { createAvatar as createProfessionalFemaleB } from '../client/professional-female-b.js';

let rafPolyfilled = false;

beforeEach(() => {
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as typeof cancelAnimationFrame;
    rafPolyfilled = true;
  }
});

afterEach(() => {
  if (rafPolyfilled) {
    // @ts-expect-error test-only browser polyfill
    delete globalThis.requestAnimationFrame;
    // @ts-expect-error test-only browser polyfill
    delete globalThis.cancelAnimationFrame;
    rafPolyfilled = false;
  }
});

function fakeClient() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    get subscriptions() {
      return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    },
    client: {
      on(event: string, fn: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      off(event: string, fn: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(fn);
      },
    } as never,
  };
}

describe.each([
  ['male', createArjun],
  ['female', createMeera],
  ['male', createVikram],
  ['female', createIshita],
  ['male', createKabir],
  ['female', createNaina],
] as const)('professional %s package entry point', (identity, createAvatar) => {
  it('keeps the public contract and owns one accessible canvas', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const fake = fakeClient();

    const avatar = createAvatar({ mount, client: fake.client });

    expect(Object.keys(avatar)).toEqual(['destroy']);
    expect(fake.subscriptions).toBeGreaterThan(0);
    expect(mount.children).toHaveLength(1);
    expect(mount.firstElementChild?.tagName).toBe('CANVAS');
    expect(mount.firstElementChild?.getAttribute('aria-label')).toContain(identity);

    avatar.destroy();
    expect(fake.subscriptions).toBe(0);
    expect(mount.children).toHaveLength(0);
    expect(() => avatar.destroy()).not.toThrow();
    mount.remove();
  });

  it('validates mixer gains at construction', () => {
    const mount = document.createElement('div');
    const client = fakeClient().client;
    expect(() => createAvatar({ mount, client, mouthGain: 2.01 })).toThrow(/mouthGain/);
    expect(mount.children).toHaveLength(0);
  });
});

describe('deprecated entry points are aliases, not copies', () => {
  it.each([
    ['interviewer-male', createMale, createArjun],
    ['interviewer-female', createFemale, createMeera],
    ['professional-male-a', createProfessionalMaleA, createVikram],
    ['professional-female-a', createProfessionalFemaleA, createIshita],
    ['professional-male-b', createProfessionalMaleB, createKabir],
    ['professional-female-b', createProfessionalFemaleB, createNaina],
  ] as const)('%s re-exports the renamed module unchanged', (_name, oldFn, newFn) => {
    expect(oldFn).toBe(newFn);
  });
});
