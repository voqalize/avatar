import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const canvasRoot = new URL('../src/canvas/', import.meta.url);
const CANVAS_AVATARS = [
  'interviewer-male',
  'interviewer-female',
  'professional-male-a',
  'professional-female-a',
  'professional-male-b',
  'professional-female-b',
] as const;

async function rig(name: string) {
  const url = new URL(`data/${name}.rig.json`, canvasRoot);
  return JSON.parse(await readFile(url, 'utf8')) as {
    images: Array<{ file: string }>;
    draws: Array<{ slot: string }>;
    meta: {
      artboard: { w: number; h: number };
      align: number[];
      live?: { persona?: Record<string, unknown> };
    };
    poses?: Record<string, unknown>;
    tracks?: Record<string, unknown>;
  };
}

describe('professional canvas-avatar assets', () => {
  it.each(CANVAS_AVATARS)('%s carries the authored 4:3 call camera', async (name) => {
    const [data, face, author] = await Promise.all([
      rig(name),
      import('../src/canvas/avatars/round/face.mjs'),
      import('../src/canvas/author/rig.mjs'),
    ]);
    const camera = author.cameraMeta(face.CAMERA);

    expect(data.meta.artboard.w / data.meta.artboard.h).toBeCloseTo(4 / 3, 12);
    expect(data.meta.artboard).toEqual(camera.artboard);
    expect(data.meta.align).toEqual(camera.align);
  });

  it.each(CANVAS_AVATARS)('%s is a live rig with every image present', async (name) => {
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
      sex: 'm',
      geo: { headW: 0.07, jawWidth: 0.64, neckWidth: 0.6, eyeSize: -0.14 },
      eye: { aperture: 0.89, refine: { brow: { head: 0.82 } } },
      mouth: { philtrum: { a: 0.46, w: 13 } },
      nose: { style: 'mature', shadow: 0.75 },
      skinDetail: { freckles: [] },
    });
    expect(female.meta.live?.persona).toMatchObject({
      sex: 'f',
      geo: { headW: -0.04, jawWidth: 0.1, neckWidth: -0.3, eyeSize: -0.08 },
      eye: { aperture: 0.88, refine: { brow: { head: 0.91 } } },
      mouth: { philtrum: { a: 0.42, w: 12 } },
      blush: 0.08,
      nose: { style: 'mature', shadow: 0.68 },
      skinDetail: { freckles: [], mole: { r: 3 } },
    });
  });

  it('keeps all four approved variants fair-toned and individually shaped', async () => {
    const variants = await Promise.all(CANVAS_AVATARS.slice(2).map((name) => rig(name)));
    const personas = variants.map(({ meta }) => meta.live?.persona as {
      skin: [number, number, number];
      geo: Record<string, number>;
    });

    expect(personas.every(({ skin }) => skin[2] >= 0.72)).toBe(true);
    expect(new Set(personas.map(({ geo }) => JSON.stringify(geo))).size).toBe(4);
  });

  it.each(CANVAS_AVATARS.slice(2))('%s keeps rear hair, wardrobe and fringe in semantic order', async (name) => {
    const data = await rig(name);
    const slots = data.draws.map(({ slot }) => slot);
    const back = slots.indexOf('wardrobe/hair-back');
    const body = slots.indexOf('wardrobe/top-body');
    const face = slots.indexOf('face');
    const shade = slots.indexOf('faceShade');
    const front = slots.indexOf('wardrobe/hair-front');

    expect(data.images.map(({ file }) => file)).toEqual([
      `${name}-top-body.webp`,
      `${name}-hair-back.webp`,
      `${name}-hair-front.webp`,
    ]);
    expect(back).toBeGreaterThanOrEqual(0);
    expect(back).toBeLessThan(face);
    expect(body).toBeLessThan(face);
    expect(front).toBeGreaterThan(shade);
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
    for (const name of CANVAS_AVATARS) {
      const entry = manifest.exports[`./avatars/${name}`];
      expect(entry?.types).toBe(`./dist/${name}.d.ts`);
      expect(entry?.default).toBe(`./dist/${name}.js`);
      await expect(readFile(new URL(`../dist/${name}.js`, import.meta.url))).resolves.not.toHaveLength(0);
    }
  });

  it('publishes the renamed identities alongside the deprecated aliases', async () => {
    const manifestUrl = new URL('../package.json', import.meta.url);
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as {
      exports: Record<string, { types?: string; default?: string }>;
    };
    const RENAMED = ['arjun', 'meera', 'vikram', 'ishita', 'kabir', 'naina'] as const;
    for (const name of RENAMED) {
      const entry = manifest.exports[`./avatars/${name}`];
      expect(entry?.types).toBe(`./dist/${name}.d.ts`);
      expect(entry?.default).toBe(`./dist/${name}.js`);
      await expect(readFile(new URL(`../dist/${name}.js`, import.meta.url))).resolves.not.toHaveLength(0);
    }
  });
});
