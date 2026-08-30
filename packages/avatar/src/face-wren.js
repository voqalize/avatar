/**
 * Avatar: "wren".
 *
 * The second line-art character, and the proof run for the recipe in
 * docs/authoring-a-face.md: static art + a POSE spec + feature blocks + META,
 * with the stroke engine imported from line-art.js rather than carried along.
 * Character: female, thirties, a big natural-curl mass, round glasses, a
 * crew-neck tee. Same idiom as peep — no strokes anywhere, ink and paper and
 * one accent — different person.
 *
 * What is deliberately different from peep, and why it is cheap:
 * - THE HAIR IS THE SILHOUETTE. A scalloped cloud four times peep's hair mass,
 *   drawn as one closed loop (outer lobes out, hairline lobes back), covering
 *   the ears entirely — which is why this file has no ear geometry at all.
 * - THE GLASSES ARE THE ACCENT. peep spends its one colour on the collar; wren
 *   wears it on the frames, which makes the two instantly tellable apart at
 *   any size where a face reads at all.
 * - CREW NECK, NOT POLO. One band arc instead of blades + placket.
 *
 * What the glasses cost the rig: the eye beans live inside the lens rings, so
 * pupil travel is capped by the frame (9/7 against peep's 11/8) — past that
 * the bean collides with the ring and reads as the eye hitting glass. In
 * exchange the ring is a fixed reference the bean moves against, which makes
 * small gaze shifts MORE legible than on peep, whose beans move against
 * nothing.
 */

import { clamp, lerp } from './params.js';
import {
  f, createFaceShell, faceApi, poseTransforms, pairedTeeth,
} from './face-core.js';
import { lidCurve, lensPath, browDeform, scaleWidths } from './face-features.js';
import { taper, taperRing, region } from './line-art.js';
import { viewBoxForHead } from './camera.js';

export const THEME = {
  ink: '#1b1b1b',
  paper: '#ffffff',
  accent: '#f97415',
  mouthIn: '#1b1b1b',
  teeth: '#ffffff',
  tongue: '#8d7f79',
};

// Wren's hair cloud is her visible crown; the skull begins well below it.
const FRAME = { centerX: 380, crownY: 102, chinY: 575 };
const VB = viewBoxForHead(FRAME);

export const META = {
  viewBox: { x: VB.x, y: VB.y, w: VB.w, h: VB.h },
  mouthCrop: { x: 298, y: 432, w: 164, h: 96 },
};

// --- landmarks --------------------------------------------------------------
const CX = FRAME.centerX;
const HEAD_TOP = 148;
const CHIN_Y = 572;

const EYE = { y: 386, dx: 55, rx: 15, ry: 17.5, lidPow: 1, squintGain: 0.7 };
const NOSE_TOP = 408;
const MOUTH = { cx: CX, cy: 486 };
const MOUTH_APERTURE = 36;

// Brows: shorter and rounder than peep's, sitting clear above the lens rings
// (lens top is y=355; a full browRaise lifts these 15 units and they still
// never touch the frames). Drawn control points, per the peep correction —
// the arch is not recoverable from endpoints.
const BROW_L = [[CX - 22, 342], [CX - 40, 334], [CX - 58, 330], [CX - 72, 331],
                [CX - 82, 334], [CX - 89, 338], [CX - 93, 343]];
const BROW_R = [[CX + 24, 340], [CX + 42, 332], [CX + 60, 329], [CX + 73, 330],
                [CX + 82, 333], [CX + 88, 337], [CX + 92, 342]];

// ---------------------------------------------------------------------------
// Static art: head.
//
// Same three-segment jaw rule as every head in this project (an unbroken
// ear-to-ear curve is an egg), but the runs are softer: the gonion corner is
// rounded off and the chin pad is narrower — that softness, not any single
// feature, is most of what makes this face read as a different person before
// the hair even loads. Chin a touch left of midline; symmetric heads read
// as machine output.
// ---------------------------------------------------------------------------
const HEAD = [
  [CX, HEAD_TOP],
  [452, 147], [520, 204], [524, 288],
  [527, 340], [523, 390], [520, 428],
  [518, 462], [513, 486], [502, 510],
  [488, 532], [456, 558], [426, 568],
  [408, 575], [352, 574], [334, 566],
  [308, 554], [282, 534], [264, 508],
  [250, 482], [244, 458], [248, 426],
  [242, 390], [237, 340], [240, 288],
  [244, 202], [308, 145], [CX, HEAD_TOP],
];
const HEAD_W = [3.5, 7, 11, 14, 15, 13.5, 10, 7, 4.5, 3.5];

// Neck: peep's truncated-cone construction, narrower. Fused into the head
// layer and run long past the neckline for the same layer-parallax reasons.
const NECK_FILL =
  'M336 514C326 575 318 630 316 700L316 790L444 790L444 700C442 630 434 575 424 514Z';
const NECK_L = [[336, 532], [329, 588], [323, 656], [320, 750]];
const NECK_R = [[424, 528], [431, 584], [437, 654], [440, 750]];
const JAW_UNDER = [[336, 560], [354, 586], [408, 588], [428, 558]];

// ---------------------------------------------------------------------------
// Static art: hair — the curl cloud.
//
// One closed loop: outer silhouette left-to-right over the crown as a chain of
// LOBES (each segment's controls pushed outward, so consecutive lobes meet at
// soft cusps — that cusp rhythm is what says "curls" with zero interior
// marks), then the hairline right-to-left back across the forehead as smaller
// lobes pointing down. What the loop encloses is the hair band itself: the
// sides run 40 units wide down to y≈470, which is why wren needs no ears.
// ---------------------------------------------------------------------------
const HAIR = [
  [252, 468],
  // up the left side, three outer lobes
  [214, 442], [206, 408], [218, 382],
  [188, 352], [190, 306], [218, 284],
  [196, 240], [222, 196], [262, 186],
  // over the crown
  [286, 138], [330, 116], [366, 124],
  [398, 102], [446, 106], [462, 130],
  [508, 138], [534, 170], [526, 196],
  // down the right side
  [560, 226], [562, 268], [546, 290],
  [568, 322], [566, 362], [538, 388],
  [552, 424], [540, 456], [508, 466],
  // transition onto the hairline
  [500, 462], [498, 458], [496, 452],
  // back across the forehead, right to left: smaller lobes, pointing down
  [500, 396], [498, 352], [486, 330],
  [482, 296], [468, 278], [452, 272],
  [430, 252], [396, 246], [380, 256],
  [362, 242], [326, 252], [306, 270],
  [288, 282], [278, 306], [272, 330],
  [262, 352], [258, 400], [258, 452],
  // close the loop at the bottom-left
  [256, 460], [254, 464], [252, 468],
];
const HAIR_D = region(HAIR);

// ---------------------------------------------------------------------------
// Static art: glasses.
//
// Round frames in the ACCENT colour — wren's version of peep's collar trim.
// Rings are taperRings with a gently uneven profile (first and last width
// equal, or the ring seams at the 3 o'clock point). The temples run outward
// and vanish under the hair band, which is what lets them be four points long.
// ---------------------------------------------------------------------------
const LENS_R = 29;
const K = 0.5523; // circle-as-four-cubics constant

function circlePts(cx, cy, r) {
  const k = r * K;
  return [
    [cx + r, cy], [cx + r, cy + k], [cx + k, cy + r], [cx, cy + r],
    [cx - k, cy + r], [cx - r, cy + k], [cx - r, cy], [cx - r, cy - k],
    [cx - k, cy - r], [cx, cy - r], [cx + k, cy - r], [cx + r, cy - k],
    [cx + r, cy],
  ];
}
const LENS_L = circlePts(CX - EYE.dx, EYE.y, LENS_R);
const LENS_R_ = circlePts(CX + EYE.dx, EYE.y, LENS_R);
const RING_W = [5, 6, 5, 6.5, 5];
const BRIDGE = [[CX - 26, 378], [CX - 10, 366], [CX + 10, 366], [CX + 26, 378]];
const TEMPLE_L = [[CX - 86, 384], [CX - 100, 380], [CX - 112, 378], [CX - 121, 378]];
const TEMPLE_R = [[CX + 86, 384], [CX + 100, 380], [CX + 112, 378], [CX + 121, 378]];

/** The nose: one mark, a shorter hook than peep's — the bridge work is done
 *  by the glasses, so the nose only has to land the tip. */
const NOSE_D = taper(
  [[CX - 3, NOSE_TOP], [CX - 10, 424], [CX - 15, 438], [CX - 9, 448],
   [CX - 3, 455], [CX + 9, 453], [CX + 15, 444]],
  [2, 8, 3]
);

// ---------------------------------------------------------------------------
// Static art: torso — a crew-neck tee.
//
// Same two-run shoulder construction as peep (outer arm edge, hard turn at
// the acromion, near-horizontal trapezius shelf), set slightly narrower. The
// neckline is one band arc with an ink underline — no blades, no placket.
// ---------------------------------------------------------------------------
const TORSO = [
  [60, 950],
  [62, 864], [104, 750], [184, 720],
  [240, 710], [286, 676], [322, 632],
  [334, 662], [426, 664], [440, 628],
  [474, 672], [518, 706], [570, 716],
  [648, 746], [694, 860], [696, 950],
];
const TORSO_W = [9, 10, 8, 7.5, 10, 9];

const SEAM_L = [[186, 722], [168, 782], [172, 862], [186, 950]];
const SEAM_R = [[568, 718], [587, 778], [583, 858], [572, 950]];

const NECKBAND = [[322, 630], [340, 645], [360, 655], [380, 658],
                  [400, 654], [422, 644], [438, 627]];

// Two creases, on the right this time — cloth folds where the body pulls it,
// and mirroring peep's left-side set would make the two shirts read as the
// same drawing recoloured.
const CREASES = [
  { p: [[452, 738], [447, 764], [446, 788], [450, 806]], w: [2, 6, 2] },
  { p: [[478, 742], [474, 766], [473, 790], [476, 808]], w: [2, 5, 2] },
];

// ---------------------------------------------------------------------------
// Layers: the same four as peep, same order, same parallax.
// ---------------------------------------------------------------------------
const PARALLAX = { head: 1.0, body: 0.1, features: 1.22, hair: 1.12 };
const LAYERS = ['head', 'body', 'features', 'hair'];
const PIVOT = { x: CX, y: 700 };

// yawPx a touch under peep's 28: the hair cloud is a much larger mass and at
// 28 its parallax slide against the head read as a wig shifting.
const POSE = {
  leanTravel: 23, leanPivot: { x: PIVOT.x, y: 560 },
  shrugLift: 30, shrugTiltDeg: 1.8, shrugPivot: { x: PIVOT.x, y: 800 },
  yawPx: 26, pitchPx: 16,
  pivot: PIVOT,
  // peep's breath and trunk numbers; same construction, same art units, and
  // the two characters should breathe alike. See face-peep.js for the
  // derivation.
  breathSwell: 0.008, swellPivot: { x: CX, y: 950 },
  turnPx: 16,
  layers: LAYERS, parallax: PARALLAX,
  torsoLayers: ['body'],
  units: 1,
};

// ---------------------------------------------------------------------------
// Generators: mouth. peep's contour model with wren's landmarks — the model
// carried over intact; only the sizing constants are this face's own. See
// face-peep.js for the full derivation commentary (aperture-not-centreline,
// the 0.18 compensation ramp, 3:1 downward opening, the cubic 0.75 solve).
// ---------------------------------------------------------------------------
function mouthGeometry(p) {
  const cx = MOUTH.cx;
  const cy = MOUTH.cy;
  const open = clamp(p.mouthOpen);
  const round = clamp(p.mouthRound);
  const tuck = clamp(p.mouthTuck);

  const w = (24 + clamp(p.mouthWidth) * 30) * (1 - 0.36 * round);

  const t = 1 - 0.4 * clamp(p.mouthPress);
  const profile = [2.5 * t, 9.5 * t, 3 * t, 10.5 * t * (1 + 0.35 * tuck), 2.5 * t];
  const halfUp = profile[1] / 2;
  const halfLo = profile[3] / 2;

  const h = open * MOUTH_APERTURE;
  const k = clamp(open / 0.18);

  const yL = cy - 1.5 - p.mouthCornerL * 22;
  const yR = cy - 1.5 - p.mouthCornerR * 22;

  const apTop = cy - h * 0.25;
  let apBot = cy + h * 0.75;
  if (tuck > 0) apBot = Math.max(apTop + 6, apBot - tuck * (h * 0.6 + 4));

  const cornerMid = (yL + yR) / 8;
  const topY = (apTop - k * halfUp - cornerMid) / 0.75;
  const botY = (apBot + k * halfLo - cornerMid) / 0.75;

  const contour = [
    [cx - w, yL],
    [cx - w * 0.55, topY], [cx + w * 0.55, topY], [cx + w, yR],
    [cx + w * 0.55, botY], [cx - w * 0.55, botY], [cx - w, yL],
  ];

  const innerTop = cornerMid + 0.75 * topY + halfUp;
  const innerBot = cornerMid + 0.75 * botY - halfLo;

  return { contour, profile, cx, cy, w, h, topY, botY, innerTop, innerBot, open, tuck };
}

// Eyes: the shared lid curve, FILLED, and nothing over it. That is the whole
// of this eye and it is a choice, not a shortfall — see the header. peep needs
// an iris travelling inside an aperture because its beans move against
// nothing; wren's bean moves against a fixed ring, and a solid mark shifting
// against that reference is the stronger gaze cue at tile size.
const EYE_CURVE = lidCurve(EYE);

// Brows: the shared deformation, peep's gains, wren's points and a lighter
// profile — the mark is thinner because the glasses already carry weight here.
const BROW_GAINS = { up: 15, down: 15, downSkew: 0, inner: 11, angle: 12, bulk: 0 };
const BROW_W = [3, 12, 6];
const BROW = browDeform(BROW_GAINS);

// ---------------------------------------------------------------------------
// Static markup
// ---------------------------------------------------------------------------
const HEAD_FILL = region(HEAD);
const HEAD_RING = taperRing(HEAD, HEAD_W, 10);

function markup(id, t) {
  const ink = (d) => `<path d="${d}" fill="${t.ink}"/>`;
  return `
<svg id="${id}" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" xmlns="http://www.w3.org/2000/svg"
     preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%">
  <defs><clipPath id="${id}-clipMouth"><path id="${id}-clipMouthP" d=""/></clipPath></defs>

  <!-- head and neck. No ears: the hair band covers them (see the hair note).
       Hair underlay at head parallax, same insurance as peep's — the cloud
       abuts the skull with no margin, and the hair layer slides against the
       head under yaw. -->
  <g id="${id}-head">
    <path d="${NECK_FILL}" fill="${t.paper}"/>
    ${ink(taper(NECK_L, [3, 8, 6]))}
    ${ink(taper(NECK_R, [3, 8, 6]))}
    <path d="${HEAD_FILL}" fill="${t.paper}"/>
    ${ink(HEAD_RING)}
    ${ink(taper(JAW_UNDER, [2, 5.5, 2]))}
    <path d="${HAIR_D}" fill="${t.ink}"/>
  </g>

  <!-- tee: silhouette, sleeve seams, neckband, creases -->
  <g id="${id}-body">
    <path d="${region(TORSO)}" fill="${t.paper}"/>
    ${ink(taper(TORSO, TORSO_W))}
    ${ink(taper(SEAM_L, [6, 7, 5]))}
    ${ink(taper(SEAM_R, [6, 7, 5]))}
    ${ink(taper(NECKBAND, [5, 8, 5]))}
    ${CREASES.map((c) => ink(taper(c.p, c.w))).join('\n    ')}
  </g>

  <!-- features: brows, eyes, nose, glasses, mouth -->
  <g id="${id}-features">
    <path id="${id}-browL" fill="${t.ink}"/>
    <path id="${id}-browR" fill="${t.ink}"/>
    <g id="${id}-eyes">
      <path id="${id}-eyeL" fill="${t.ink}"/>
      <path id="${id}-eyeR" fill="${t.ink}"/>
    </g>
    <path d="${NOSE_D}" fill="${t.ink}"/>
    <path d="${taperRing(LENS_L, RING_W)}" fill="${t.accent}"/>
    <path d="${taperRing(LENS_R_, RING_W)}" fill="${t.accent}"/>
    <path d="${taper(BRIDGE, [4, 5.5, 4])}" fill="${t.accent}"/>
    <path d="${taper(TEMPLE_L, [4, 4.5, 5])}" fill="${t.accent}"/>
    <path d="${taper(TEMPLE_R, [4, 4.5, 5])}" fill="${t.accent}"/>
    <g id="${id}-mouth">
      <path id="${id}-mouthIn" fill="${t.mouthIn}"/>
      <g clip-path="url(#${id}-clipMouth)">
        <ellipse id="${id}-tongue" fill="${t.tongue}"/>
        <path id="${id}-teeth" fill="${t.teeth}"/>
        <path id="${id}-teethLo" fill="${t.teeth}" opacity=".85"/>
      </g>
      <path id="${id}-lips" fill="${t.ink}"/>
    </g>
  </g>

  <!-- hair -->
  <g id="${id}-hair">
    <path d="${HAIR_D}" fill="${t.ink}"/>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Renderer — peep's apply() shape exactly; only the travels differ.
// ---------------------------------------------------------------------------
let uid = 0;

export function createFace(mount, theme = {}) {
  const t = Object.assign({}, THEME, theme);
  const id = `wren${++uid}`;
  const { svg, $, set } = createFaceShell(mount, id, markup(id, t));

  const el = {
    head: $('head'), body: $('body'), features: $('features'), hair: $('hair'),
    browL: $('browL'), browR: $('browR'),
    eyes: $('eyes'), eyeL: $('eyeL'), eyeR: $('eyeR'),
    mouthIn: $('mouthIn'), lips: $('lips'), clipMouth: $('clipMouthP'),
    teeth: $('teeth'), teethLo: $('teethLo'), tongue: $('tongue'),
  };

  function apply(p) {
    poseTransforms(p, set, el, POSE);

    // Eyes: bean travel capped by the lens rings — see the header. 10 is the
    // most x the frame allows (bean edge 25 against an inner radius of 26);
    // DISTRACTED is the state that needs every unit of it, same lesson as
    // peep's 7→11 raise, hit from the other side.
    set(el.eyes, 'transform', `translate(${f(p.pupilX * 10)} ${f(p.pupilY * 7)})`);

    const lidFollow = Math.max(0, p.pupilY) * 0.22;
    const bean = (cx, cy, lid, squint, tilt) =>
      lensPath(cx, cy, EYE_CURVE(cy, lid, squint), tilt);
    set(el.eyeL, 'd', bean(CX - EYE.dx, EYE.y + 1, p.lidL + lidFollow, p.squintL, -3));
    set(el.eyeR, 'd', bean(CX + EYE.dx, EYE.y - 1, p.lidR + lidFollow, p.squintR, 3));

    const bL = BROW(BROW_L, p.browRaiseL, p.browAngleL, p.browInnerL);
    const bR = BROW(BROW_R, p.browRaiseR, p.browAngleR, p.browInnerR);
    set(el.browL, 'd', taper(bL.pts, scaleWidths(BROW_W, bL.weight), 6));
    set(el.browR, 'd', taper(bR.pts, scaleWidths(BROW_W, bR.weight), 6));

    const m = mouthGeometry(p);
    const contour = region(m.contour);
    set(el.mouthIn, 'd', contour);
    set(el.clipMouth, 'd', contour);
    set(el.lips, 'd', taperRing(m.contour, m.profile, 12));
    // Keyed off the drawn gap, not mouthOpen — a half-opaque interior is GREY,
    // and grey on a two-value face reads as a rendering fault (peep's F bug).
    set(el.mouthIn, 'opacity', f(clamp((m.innerBot - m.innerTop) / 3)));

    pairedTeeth(p, set, el, m);

    const tg = clamp(p.tongue);
    set(el.tongue, 'cx', f(m.cx));
    set(el.tongue, 'cy', f(m.innerBot + 6 - tg * ((m.innerBot - m.innerTop) * 0.8 + 6)));
    set(el.tongue, 'rx', f(m.w * 0.58));
    set(el.tongue, 'ry', '8');
    set(el.tongue, 'opacity', tg > 0.02 ? '1' : '0');
  }

  return faceApi(mount, svg, apply, t);
}

/**
 * This face as a **Face** record — `{ create, meta }`, the shape
 * `createAvatar({ face })` takes. Importing it costs this drawing and nothing
 * else; `src/faces.js` is the all-three table, for tooling.
 */
export const wren = { create: createFace, meta: META };
