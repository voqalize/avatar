import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const canvasRoot = new URL('../src/canvas/', import.meta.url);

async function rig(name: string) {
  const url = new URL(`data/${name}.rig.json`, canvasRoot);
  return JSON.parse(await readFile(url, 'utf8')) as {
    images: Array<{ file: string }>;
    meta: { live?: { persona?: Record<string, unknown> } };
    poses?: Record<string, unknown>;
    tracks?: Record<string, unknown>;
  };
}

describe('professional interviewer assets', () => {
  it.each(['interviewer-male', 'interviewer-female'])('%s is a live rig with every image present', async (name) => {
    const data = await rig(name);
    expect(data.meta.live).toBeTruthy();
    expect(data.images.length).toBeGreaterThan(0);
    for (const image of data.images) {
      const url = new URL(`data/img/${image.file}`, canvasRoot);
      await expect(readFile(url)).resolves.not.toHaveLength(0);
    }
  });

  it('keeps the measured identity-specific fidelity settings', async () => {
    const male = await rig('interviewer-male');
    const female = await rig('interviewer-female');
    expect(male.meta.live?.persona).toMatchObject({
      sex: 'm', eye: { aperture: 0.92, refine: { brow: { head: 0.78 } } },
      mouth: { philtrum: { a: 0.56, w: 14 } }, nose: { style: 'mature', shadow: 0.86 },
      skinDetail: { freckles: expect.any(Array) },
    });
    expect(female.meta.live?.persona).toMatchObject({
      sex: 'f', eye: { aperture: 0.9, refine: { brow: { head: 0.9 } } },
      mouth: { philtrum: { a: 0.48, w: 12 } }, blush: 0.3, nose: { style: 'mature', shadow: 0.74 },
      skinDetail: { freckles: expect.any(Array), mole: expect.any(Object) },
    });
  });

  it('ships the male without glasses', async () => {
    const male = await rig('interviewer-male');
    expect(male.images.map(({ file }) => file)).not.toContain('round-m3-glasses-front.webp');
    await expect(readFile(new URL('data/img/round-m3-glasses-front.webp', canvasRoot))).rejects.toThrow();
  });

  it('ships the male identity without unused authored animation libraries', async () => {
    const male = await rig('interviewer-male');
    expect(male.poses).toEqual({});
    expect(male.tracks).toEqual({});
  });

  it('publishes both createAvatar modules', async () => {
    const manifestUrl = new URL('../package.json', import.meta.url);
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as {
      exports: Record<string, { types?: string; default?: string }>;
    };
    for (const name of ['interviewer-male', 'interviewer-female']) {
      const entry = manifest.exports[`./avatars/${name}`];
      expect(entry?.types).toBe(`./dist/${name}.d.ts`);
      expect(entry?.default).toBe(`./dist/${name}.js`);
      await expect(readFile(new URL(`../dist/${name}.js`, import.meta.url))).resolves.not.toHaveLength(0);
    }
  });
});
