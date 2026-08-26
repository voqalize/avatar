/** Apply the stakeholder-reviewed, incremental interviewer refinements. */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SCALE = 1.178977;

const refinements = [
  {
    name: 'interviewer-male',
    persona: {
      sex: 'm',
      geo: {
        plateTop: 975.952185,
        headW: 0.07,
        jawWidth: 0.64,
        neckWidth: 0.6,
        eyeSize: -0.14,
        eyeSpace: -0.015,
        browH: -0.32,
        noseW: 0.04,
      },
      skin: [30, 0.37, 0.59],
      lips: { up: [24, 0.42, 0.5192], low: [22, 0.44, 0.5487] },
      iris: {
        hue: 26,
        saturation: 0.15,
        brightness: 0.5,
        sat: 0.42,
        light: 0.28,
        eye: [84, 57, 39],
      },
      brow: { weight: 1.2, colour: [20, 0.28, 0.16] },
      lash: { weight: 0 },
      eye: {
        aperture: 0.89,
        refine: {
          lidFoldDepth: 11,
          lidFoldAlpha: 0.78,
          creaseDepth: 3,
          brow: { head: 0.82, peak: 0.94, tail: 0.9 },
        },
      },
      mouth: { philtrum: { a: 0.46, w: 13 } },
      nose: { style: 'mature', bridge: 0.96, base: 0.95, nostril: 0.82, shadow: 0.75 },
      skinDetail: { opacity: 0.3, freckles: [] },
      blush: 0,
    },
    bitmaps: {
      'wardrobe/hair-back': { m: [SCALE, 0, 0, SCALE, 175.695976, 120.415341], a: 0 },
      'wardrobe/top-body': { m: [1.196661655, 0, 0, SCALE, -76.280912, 975.952185], a: 1 },
      'wardrobe/hair-front': { m: [1.15539746, 0, 0, 1.15539746, 188.640345, 247.509078], a: 1 },
    },
    neckShadowAlpha: 0.11,
    blushPaintAlpha: 0,
  },
  {
    name: 'interviewer-female',
    persona: {
      sex: 'f',
      geo: {
        plateTop: 1070,
        headW: -0.04,
        jawWidth: 0.1,
        neckWidth: -0.3,
        eyeSize: -0.08,
        eyeSpace: -0.02,
        browH: -0.11,
        noseW: 0.01,
      },
      skin: [30, 0.42, 0.66],
      lips: { up: [4, 0.32, 0.48], low: [4, 0.32, 0.55] },
      iris: {
        hue: 26,
        saturation: 0.15,
        brightness: 0.5,
        sat: 0.43,
        light: 0.28,
        eye: [88, 60, 41],
      },
      brow: { weight: 1, colour: [20, 0.28, 0.19] },
      lash: { weight: 0.9 },
      eye: {
        aperture: 0.88,
        refine: {
          lidFoldDepth: 11.5,
          lidFoldAlpha: 0.82,
          creaseDepth: 3.1,
          brow: { head: 0.91, peak: 0.97, tail: 0.95 },
        },
      },
      mouth: { philtrum: { a: 0.42, w: 12 } },
      nose: { style: 'mature', bridge: 0.88, base: 0.9, nostril: 0.76, shadow: 0.68 },
      skinDetail: {
        opacity: 0.55,
        freckles: [],
        mole: { side: -1, along: 0.48, lift: 22, r: 3 },
      },
      blush: 0.08,
    },
    bitmaps: {
      'wardrobe/hair-back': { m: [1.13181792, 0, 0, 1.13181792, 133.202435, 146.352837], a: 1 },
      'wardrobe/top-body': { m: [1.196661655, 0, 0, SCALE, -40.379459, 993.741957], a: 1 },
      // Keep the crown at its original seating while the rear bob tightens
      // around it; shrinking both masks exposes a skin-coloured seam between
      // two otherwise aligned cutouts and recreates the wig read.
      'wardrobe/hair-front': { m: [SCALE, 0, 0, SCALE, 188.664725, 243.028965], a: 1 },
    },
    neckShadowAlpha: 0.09,
    blushPaintAlpha: 0.016,
    moleAlpha: 0.297,
  },
];

for (const refinement of refinements) {
  const url = new URL(`../src/canvas/data/${refinement.name}.rig.json`, import.meta.url);
  const path = fileURLToPath(url);
  const rig = JSON.parse(await readFile(path, 'utf8'));

  rig.meta.live.persona = refinement.persona;
  for (const draw of rig.draws) {
    const bitmap = refinement.bitmaps[draw.slot];
    if (bitmap) Object.assign(draw, bitmap);

    // Tiny cheek marks become dirt at call size. Keep the woman's single mole
    // as identity detail, but remove freckles from both interviewer variants.
    if (draw.slot.startsWith('skinFreckle')) draw.a = 0;
    if (draw.slot === 'skinMole' && refinement.moleAlpha != null) draw.a = refinement.moleAlpha;
  }

  // Two dark bands below the chin make a long neck look cylindrical. Retain
  // one shallow cast shadow so the jaw still separates from the neck.
  const neckShadow = rig.draws.find(({ slot }) => slot === 'neckSh');
  rig.paints[neckShadow.paint].c[3] = refinement.neckShadowAlpha;
  const blush = rig.draws.find(({ slot }) => slot === 'blushL');
  rig.paints[blush.paint].c[3] = refinement.blushPaintAlpha;

  await writeFile(path, `${JSON.stringify(rig)}\n`);
}
