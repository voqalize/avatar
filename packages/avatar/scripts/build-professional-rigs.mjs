/** Build the four reference-approved professional canvas identities. */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { toRig } from '../src/canvas/author/rig.mjs';
import {
  CAMERA,
  HAND,
  HAND_FRAME,
  P,
  buildDraws,
  ctrlFor,
  makeKit,
} from '../src/canvas/avatars/round/face.mjs';

const HAIR_SLOTS = new Set(['hairBack', 'fringe', 'hairHi']);
const GARMENT_SLOTS = new Set(['shirt', 'collar']);

const commonIris = {
  hue: 27,
  saturation: 0.15,
  brightness: 0.46,
  sat: 0.4,
  light: 0.25,
  eye: [76, 52, 35],
};

const identities = [
  {
    name: 'professional-male-a',
    bodyDy: 155,
    bodyScaleX: 1.02,
    bodyScaleY: 0.99,
    hairScale: 0.92,
    hairBackAlpha: 0,
    neckShadowAlpha: 0.11,
    persona: {
      sex: 'm',
      geo: { plateTop: 765, headW: 0.03, jawWidth: 0.72, neckWidth: 0.52, eyeSize: -0.13, browH: -0.34, noseW: 0.04 },
      skin: [31, 0.34, 0.72],
      iris: commonIris,
      brow: { weight: 1.05, colour: [20, 0.26, 0.16] },
      lash: { weight: 0 },
      eye: {
        aperture: 0.78,
        irisScale: 1.13,
        finish: {
          sclera: [244, 241, 236, 1], scleraShade: [235, 231, 226, 1],
          shadeAlpha: 0.12, limbalAlpha: 0.12, glowAlpha: 0.07,
          catchAlpha: 0.6, catch2Alpha: 0, waterAlpha: 0.14,
          catch: { r: 0.15, r2: 0.04 },
        },
        refine: { lidFoldDepth: 11, lidFoldAlpha: 0.72, creaseDepth: 3, brow: { head: 0.85, peak: 0.93, tail: 0.9 } },
      },
      mouth: { philtrum: { a: 0.48, w: 13 }, lipHiAlpha: 0.48, bowAlpha: 0.46, lipCastAlpha: 0.78, seamAlpha: 0.7, commissAlpha: 0.55 },
      form: { socket: true, socketAlpha: 0.12, socketDepth: 1.45, sideShadeAlpha: 0.18, sideShadeWidth: 1.34 },
      nose: { style: 'mature', bridge: 1.08, base: 0.98, nostril: 0.84, shadow: 0.98 },
      skinDetail: { opacity: 0.34, freckles: [] },
      blush: 0,
    },
  },
  {
    name: 'professional-female-a',
    bodyDy: 264,
    bodyScaleX: 1.03,
    bodyScaleY: 0.99,
    hairScale: 0.93,
    hairBackAlpha: 0,
    headArtScale: 0.95,
    neckShadowAlpha: 0.09,
    persona: {
      sex: 'f',
      geo: { plateTop: 880, headW: -0.04, jawWidth: 0.08, neckWidth: -0.34, eyeSize: -0.06, eyeSpace: -0.02, browH: -0.12, noseW: -0.02 },
      skin: [30, 0.34, 0.75],
      lips: { up: [356, 0.34, 0.55], low: [3, 0.36, 0.64] },
      iris: commonIris,
      brow: { weight: 0.97, colour: [20, 0.28, 0.18] },
      lash: { weight: 0.68 },
      eye: {
        aperture: 0.78,
        irisScale: 1.12,
        finish: {
          sclera: [244, 241, 236, 1], scleraShade: [235, 231, 226, 1],
          shadeAlpha: 0.12, limbalAlpha: 0.12, glowAlpha: 0.07,
          catchAlpha: 0.6, catch2Alpha: 0, waterAlpha: 0.14,
          catch: { r: 0.15, r2: 0.04 },
        },
        refine: { lidFoldDepth: 11.2, lidFoldAlpha: 0.72, creaseDepth: 3, brow: { head: 0.9, peak: 0.96, tail: 0.93 } },
      },
      mouth: { philtrum: { a: 0.43, w: 12 }, lipHiAlpha: 0.48, bowAlpha: 0.46, lipCastAlpha: 0.78, seamAlpha: 0.7, commissAlpha: 0.55 },
      form: { socket: true, socketAlpha: 0.12, socketDepth: 1.45, sideShadeAlpha: 0.18, sideShadeWidth: 1.34 },
      nose: { style: 'mature', bridge: 1.05, base: 0.96, nostril: 0.76, shadow: 0.96 },
      skinDetail: { opacity: 0.28, freckles: [] },
      blush: 0.08,
    },
  },
  {
    name: 'professional-male-b',
    bodyDy: 158,
    bodyScaleX: 1.03,
    bodyScaleY: 0.99,
    hairScale: 0.88,
    neckShadowAlpha: 0.11,
    persona: {
      sex: 'm',
      geo: { plateTop: 890, headW: -0.03, jawWidth: 0.55, neckWidth: 0.8, eyeSize: -0.1, browH: -0.28, noseW: -0.01 },
      skin: [28, 0.3, 0.74],
      iris: { ...commonIris, hue: 24, eye: [72, 49, 34] },
      brow: { weight: 1.04, colour: [18, 0.25, 0.15] },
      lash: { weight: 0 },
      eye: {
        aperture: 0.77,
        irisScale: 1.14,
        finish: {
          sclera: [244, 241, 236, 1], scleraShade: [235, 231, 226, 1],
          shadeAlpha: 0.12, limbalAlpha: 0.12, glowAlpha: 0.07,
          catchAlpha: 0.6, catch2Alpha: 0, waterAlpha: 0.14,
          catch: { r: 0.15, r2: 0.04 },
        },
        refine: { lidFoldDepth: 10.5, lidFoldAlpha: 0.7, creaseDepth: 2.8, brow: { head: 0.86, peak: 0.93, tail: 0.89 } },
      },
      mouth: { philtrum: { a: 0.46, w: 13 }, lipHiAlpha: 0.48, bowAlpha: 0.46, lipCastAlpha: 0.78, seamAlpha: 0.7, commissAlpha: 0.55 },
      form: { socket: true, socketAlpha: 0.12, socketDepth: 1.45, sideShadeAlpha: 0.18, sideShadeWidth: 1.34 },
      nose: { style: 'mature', bridge: 1.07, base: 0.97, nostril: 0.82, shadow: 0.98 },
      skinDetail: { opacity: 0.3, freckles: [] },
      blush: 0,
    },
  },
  {
    name: 'professional-female-b',
    bodyDy: 6,
    bodyScaleX: 1.03,
    bodyScaleY: 0.99,
    neckShadowAlpha: 0.1,
    persona: {
      sex: 'f',
      geo: { plateTop: 757, headW: -0.07, jawWidth: 0.05, neckWidth: 0.04, eyeSize: 0, eyeSpace: -0.02, browH: -0.08, noseW: -0.02, lipFull: 0.12 },
      skin: [31, 0.31, 0.77],
      lips: { up: [358, 0.31, 0.56], low: [4, 0.34, 0.65] },
      iris: { ...commonIris, hue: 25, eye: [80, 55, 37] },
      brow: { weight: 0.82, colour: [19, 0.27, 0.18] },
      lash: { weight: 0.48 },
      eye: {
        aperture: 0.64,
        irisScale: 1.22,
        pupilScale: 0.74,
        // A longer, shallower opening changes the dominant read at call size;
        // paint-only eye refinements disappear once the portrait is reduced.
        shape: { canthus: [2, -8], widest: [0.12, -0.07] },
        marks: { lashLo: false },
        finish: {
          sclera: [244, 241, 236, 1], scleraShade: [235, 231, 226, 1],
          shadeAlpha: 0.12, limbalAlpha: 0.12, glowAlpha: 0.07,
          catchAlpha: 0.6, catch2Alpha: 0, waterAlpha: 0.14,
          catch: { r: 0.15, r2: 0.04 },
        },
        refine: { lidFoldDepth: 12, lidFoldAlpha: 0.62, creaseDepth: 3.4, brow: { head: 0.88, peak: 0.93, tail: 0.9 } },
      },
      mouth: { philtrum: { a: 0.48, w: 11.5 }, lipHiAlpha: 0.62, bowAlpha: 0.55, lipCastAlpha: 0.9, seamAlpha: 0.62, commissAlpha: 0.46 },
      form: { socket: true, socketAlpha: 0.17, socketDepth: 1.8, sideShadeAlpha: 0.235, sideShadeWidth: 1.62 },
      nose: { style: 'mature', bridge: 1.2, base: 1.05, nostril: 0.76, shadow: 1.28 },
      skinDetail: { opacity: 0.25, freckles: [] },
      blush: 0.05,
    },
  },
];

function bitmap(slot, src) {
  return { k: 'bitmap', slot, src, w: 1440, h: 1080, m: null, a: 1 };
}

function build({
  name,
  persona,
  bodyDy = 0,
  bodyScale = 1,
  bodyScaleX = bodyScale,
  bodyScaleY = bodyScale,
  hairScale = 1,
  hairBackAlpha = 1,
  headArtScale = 1,
  neckShadowAlpha = null,
}) {
  const kit = makeKit(persona);
  const draws = buildDraws(ctrlFor(persona)(), kit).map((draw) => (
    HAIR_SLOTS.has(draw.slot) || GARMENT_SLOTS.has(draw.slot) ? { ...draw, a: 0 } : draw
  ));
  // One all-front cutout pastes a bob over the ears and a ponytail over the
  // chest. The rear silhouette belongs behind ears, neck and wardrobe; only
  // the fringe and deliberate face-framing locks return above the live face.
  const backAt = draws.findIndex(({ slot }) => slot === 'neckPlate') + 1;
  draws.splice(backAt, 0, bitmap('wardrobe/hair-back', 1));
  const bodyAt = draws.findIndex(({ slot }) => slot === 'collar') + 1;
  draws.splice(bodyAt, 0, bitmap('wardrobe/top-body', 0));
  const hairAt = draws.findIndex(({ slot }) => slot === 'faceShade') + 1;
  draws.splice(hairAt, 0, bitmap('wardrobe/hair-front', 2));

  const images = [
    { id: 0, w: 1440, h: 1080, file: `${name}-top-body.webp` },
    { id: 1, w: 1440, h: 1080, file: `${name}-hair-back.webp` },
    { id: 2, w: 1440, h: 1080, file: `${name}-hair-front.webp` },
  ];
  const rig = toRig({ artboard: P.artboard, paints: kit.paints, draws, poses: {}, tracks: {}, camera: CAMERA, images });
  for (const draw of rig.draws) {
    if (draw.k !== 'bitmap') continue;
    draw.m = [...rig.meta.align];
    if (draw.slot === 'wardrobe/hair-back') {
      // This bob is a complete cutout. A second rear silhouette restores the
      // discarded lob around the neck and makes the head read forward-heavy.
      draw.a = hairBackAlpha;
    }
    if (draw.slot === 'wardrobe/top-body') {
      // A high jacket shoulder is read as a held shrug even when every motion
      // channel is neutral. X and Y stay independent so the torso can retain
      // broad support while the lapels and shoulder peaks sit below the jaw,
      // leaving the neck visible and the outer shoulder line falling away.
      const cx = 720, bottom = 1080;
      draw.m[0] *= bodyScaleX;
      draw.m[3] *= bodyScaleY;
      draw.m[4] += rig.meta.align[0] * (1 - bodyScaleX) * cx;
      draw.m[5] += rig.meta.align[3] * (1 - bodyScaleY) * bottom + bodyDy;
    }
    if (draw.slot.startsWith('wardrobe/hair-') && hairScale !== 1) {
      // Shrink about the upper skull, not the frame centre: the crown comes
      // closer to the head while the hairline stays seated at the forehead.
      const cx = 720, cy = 390;
      draw.m[0] *= hairScale;
      draw.m[3] *= hairScale;
      draw.m[4] += rig.meta.align[0] * (1 - hairScale) * cx;
      draw.m[5] += rig.meta.align[3] * (1 - hairScale) * cy;
    }
  }
  if (neckShadowAlpha !== null) {
    // Two strong horizontal bands below the chin read as a tucked head at call
    // size. Keep the cast shadow for depth, but let the neck remain one column.
    const shadow = rig.draws.find(({ slot }) => slot === 'neckSh');
    rig.paints[shadow.paint].c[3] = neckShadowAlpha;
  }
  if (headArtScale !== 1) {
    // Scale the skull artwork about the chin while leaving the neck at full
    // size. This changes the actual head-to-support ratio; shrinking the whole
    // head group about the neck base would shorten the neck and recreate the
    // same forward-heavy read one layer lower.
    const fixed = new Set(['neckPlate', 'neck', 'neckSh', 'shirt', 'collar', 'wardrobe/top-body']);
    const handSlots = new Set(draws.filter(({ group }) => group === HAND).map(({ slot }) => slot));
    const cx = 540, cy = 890;
    for (const draw of rig.draws) {
      if (fixed.has(draw.slot) || handSlots.has(draw.slot)) continue;
      draw.m[0] *= headArtScale;
      draw.m[1] *= headArtScale;
      draw.m[2] *= headArtScale;
      draw.m[3] *= headArtScale;
      draw.m[4] = headArtScale * draw.m[4] + (1 - headArtScale) * cx;
      draw.m[5] = headArtScale * draw.m[5] + (1 - headArtScale) * cy;
    }
  }
  rig.meta.iris = {
    hue: kit.p.iris.hue,
    saturation: kit.p.iris.saturation,
    brightness: kit.p.iris.brightness,
  };
  rig.meta.live = {
    face: 'avatars/round/face.mjs',
    persona,
    body: ['neckPlate', 'shirt', 'collar', 'wardrobe/top-body'],
    hand: {
      frame: HAND_FRAME,
      slots: draws.filter(({ group }) => group === HAND).map(({ slot }) => slot),
    },
  };
  return rig;
}

for (const identity of identities) {
  const url = new URL(`../src/canvas/data/${identity.name}.rig.json`, import.meta.url);
  await writeFile(fileURLToPath(url), `${JSON.stringify(build(identity))}\n`);
}
