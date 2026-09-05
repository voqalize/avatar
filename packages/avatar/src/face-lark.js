/**
 * Avatar: "lark".
 *
 * The fourth line-art character, and the first authored ENTIRELY against the
 * shared kit: `face-features.js` for the lid curve, the brow deformation and
 * the mouth contour, `face-eyes.js` for the eye type, `face-core.js` for the
 * body channels and the teeth. This module contains no feature arithmetic at
 * all — only a drawing, four specs of named numbers, and the markup.
 *
 * Character: male, forties, a short crop with a receded hairline, a squarer
 * jaw than any of the three before him, and a half-zip turtleneck. Same idiom
 * as the others: no strokes anywhere, ink and paper and one accent.
 *
 * What is deliberately different, and why each is cheap:
 * - THE JAW IS THE SILHOUETTE. peep is round, wren is soft, myna is oval;
 *   lark turns a real corner at the gonion and runs almost straight to a flat
 *   chin. At 130 px the jaw is the only head-shape information that survives,
 *   so it is the whole of "different person" before the hair loads.
 * - THE EARS SHOW. A short crop puts them back on the drawing — wren has no
 *   ear geometry at all because her hair covers them — and an exposed ear is
 *   the cheapest cue that the hair is SHORT rather than merely dark.
 * - THE ACCENT IS A ZIP PULL. peep spends its one colour on collar trim, wren
 *   on frames, myna on hoops. lark wears it as a half-zip on the chest: one
 *   small saturated mark low in the frame, which leaves the whole upper face
 *   in two values.
 * - THE HIGH NECKLINE IS THE WHOLE GARMENT. Four passes at an actual drawn
 *   turtleneck collar all failed, each differently; the note above the torso
 *   records them. What survived is the torso's own neckline run high and flat,
 *   with the zip to say it closes at the throat.
 *
 * EYE TYPE: `irisEye`, and that was decided by the rule in face-eyes.js rather
 * than by taste. lark has no glasses, so there is no fixed reference frame for
 * a solid bean to travel against; the gaze has to be carried by an iris moving
 * inside an aperture, as it is on peep. A bean here would read as a dot
 * sliding in a void.
 *
 * NOT STAKEHOLDER-APPROVED, and deliberately not shipped. There is no
 * reference image behind this face — it was authored from a text brief, which
 * is exactly what `koel` did before it was rejected on sight
 * (docs/authoring-a-face.md § The staged process, stage 0). It exists to
 * measure what the shared kit costs a new character, not to be one. It is
 * absent from the package's public exports for that reason.
 */

import { clamp } from './params.js';
import {
  f, createFaceShell, faceApi, poseTransforms, pairedTeeth,
} from './face-core.js';
import { browDeform, scaleWidths, mouthContour } from './face-features.js';
import { irisEye } from './face-eyes.js';
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

// The crop crown is the HAIR's top, not the skull's: the crop sits close, so
// the two are only ~14 units apart here against wren's ~46.
const FRAME = { centerX: 380, crownY: 158, chinY: 584 };
const VB = viewBoxForHead(FRAME);

export const META = {
  viewBox: { x: VB.x, y: VB.y, w: VB.w, h: VB.h },
  mouthCrop: { x: 298, y: 438, w: 164, h: 96 },
};

// --- landmarks --------------------------------------------------------------
const CX = FRAME.centerX;
const HEAD_TOP = 172;
const CHIN_Y = 584;

// Wider than tall, which is the shape an aperture can be cut from: peep went
// rx 14 -> 16.5 for exactly this reason, because an almond cut from a round
// bean needs an absurdly heavy lid line and a round aperture reads as a
// target. 16.5 x 15 is peep's lesson applied rather than rediscovered.
const EYE = {
  y: 392, dx: 57, rx: 16.5, ry: 15, lidPow: 1, squintGain: 0.7, lidFollow: 0.22,
  aperture: { x: 3.0, top: 5.5, bot: 4.5 },
  irisR: 8.0,
  irisTravel: { x: 4.5, y: 2.2 },
};
const NOSE_TOP = 408;
const MOUTH = { cx: CX, cy: 496 };
const MOUTH_APERTURE = 38;

// Brows: straighter and heavier than the others', and set LOW — a small
// brow-to-lid gap is most of what separates this face from wren's, and it is
// the one proportion that survives the tile. Drawn control points per the peep
// correction: the arch is not recoverable from its endpoints.
const BROW_L = [[CX - 20, 346], [CX - 40, 340], [CX - 60, 337], [CX - 78, 338],
                [CX - 90, 341], [CX - 98, 345], [CX - 103, 350]];
const BROW_R = [[CX + 22, 344], [CX + 42, 338], [CX + 62, 335], [CX + 79, 336],
                [CX + 90, 339], [CX + 97, 343], [CX + 101, 348]];

// ---------------------------------------------------------------------------
// Static art: head.
//
// The three-segment jaw rule, taken further than any head here so far: the
// sides run nearly vertical, the gonion turns a real corner, and the chin is a
// flat pad rather than a curve. Chin sits 3 units left of midline — a
// symmetric head reads as machine output.
// ---------------------------------------------------------------------------
const HEAD = [
  [CX, HEAD_TOP],
  [446, 170], [508, 208], [518, 262],
  [524, 316], [522, 366], [520, 412],
  [516, 452], [510, 480], [498, 504],
  [484, 534], [452, 566], [428, 576],
  [412, 583], [352, 584], [330, 576],
  [306, 566], [276, 536], [262, 506],
  [250, 482], [244, 452], [240, 412],
  [238, 366], [236, 316], [242, 262],
  [252, 206], [314, 168], [CX, HEAD_TOP],
];
const HEAD_W = [3.5, 6.5, 10, 13, 14, 12.5, 9.5, 6.5, 4, 3.5];

// Ears: back on the drawing, because the crop is short. Set low and close —
// a jug-eared read is a caricature, and this face is not one.
const EAR_L = [[240, 388], [214, 376], [196, 402], [202, 438], [208, 468], [232, 480], [246, 470]];
const EAR_R = [[520, 388], [546, 376], [564, 402], [558, 438], [552, 468], [528, 480], [514, 470]];
const EAR_L_IN = [[224, 406], [212, 416], [210, 436], [218, 452]];
const EAR_R_IN = [[536, 406], [548, 416], [550, 436], [542, 452]];

// Neck: a heavier column than wren's — it carries the turtleneck, and a thin
// neck under a thick collar reads as a head balanced on a bottle.
const NECK_FILL =
  'M330 520C320 578 314 626 312 700L312 790L448 790L448 700C446 626 440 578 430 520Z';
const NECK_L = [[332, 546], [326, 592], [320, 650], [317, 750]];
const NECK_R = [[428, 542], [434, 588], [440, 648], [443, 750]];
const JAW_UNDER = [[332, 566], [352, 594], [412, 596], [432, 564]];

// ---------------------------------------------------------------------------
// Static art: hair — a short crop with a receded hairline.
//
// One closed loop, same construction as wren's cloud but with the lobe rhythm
// taken out: the outer edge hugs the skull about 12 units proud, and the
// HAIRLINE is where all the character is — a shallow M, higher at the temples
// than at the middle, which is the single cheapest "male, forties" cue there
// is. The sideburns run down in front of the ears and stop level with the
// tragus.
// ---------------------------------------------------------------------------
const HAIR = [
  [244, 404],
  // up the left side, close to the skull
  [236, 372], [230, 330], [230, 292],
  [232, 244], [258, 196], [304, 172],
  // over the crown
  [332, 158], [368, 156], [396, 158],
  [438, 160], [488, 186], [508, 224],
  // down the right side
  [518, 258], [522, 300], [522, 340],
  [522, 372], [518, 388], [516, 404],
  // onto the hairline, right sideburn first
  [512, 396], [508, 384], [506, 372],
  // back across the forehead: high at the temples, dipping at the middle
  [504, 340], [496, 314], [474, 300],
  [452, 288], [424, 282], [400, 288],
  [388, 292], [372, 292], [360, 288],
  [336, 280], [308, 286], [288, 300],
  [266, 314], [256, 340], [254, 372],
  // close down the left sideburn
  [252, 384], [248, 396], [244, 404],
];
const HAIR_D = region(HAIR);

/** The nose: one mark, straighter and longer than peep's hook — a strong
 *  bridge is the other half of the squarer read the jaw starts. */
const NOSE_D = taper(
  [[CX - 4, NOSE_TOP], [CX - 12, 430], [CX - 18, 448], [CX - 12, 460],
   [CX - 4, 468], [CX + 12, 466], [CX + 19, 456]],
  [2.5, 9, 3.5]
);

// ---------------------------------------------------------------------------
// Static art: torso — a half-zip turtleneck.
//
// The shoulders are the same two-run construction as peep and wren (outer arm
// edge, hard turn at the acromion, near-horizontal trapezius shelf), set a
// little wider — this is the heaviest body of the four. The turtleneck is not
// a separate shape: it is the torso's OWN neckline, run high and flat instead
// of dipping, so the collar cannot drift free of the shoulders it belongs to.
// ---------------------------------------------------------------------------
const TORSO = [
  [50, 950],
  [52, 858], [96, 742], [178, 712],
  [236, 700], [288, 674], [322, 630],
  [330, 598], [430, 598], [438, 630],
  [472, 674], [524, 700], [578, 710],
  [658, 740], [704, 856], [706, 950],
];
const TORSO_W = [10, 11, 9, 8.5, 11, 10];

const SEAM_L = [[180, 714], [160, 776], [164, 858], [178, 950]];
const SEAM_R = [[578, 710], [598, 772], [594, 854], [582, 950]];

// THE COLLAR IS THE NECKLINE AND NOTHING ELSE, and getting here took four
// passes that are worth recording because each failed differently and none of
// them failed for a reason the kit could have caught:
//
//   1. a separate collar region, top at y=544 — ABOVE the chin at 584, so it
//      read as a brace strapped to the jaw;
//   2. attached to the torso but with a band hugging the opening — two nested
//      arcs 30 units apart, which is a choker;
//   3. the band moved 76 units down — an arc across the chest with nothing
//      vertical under it, which is a scoop neck however low you put it;
//   4. sides added to make a tube — vertical sides plus a horizontal base is a
//      RECTANGLE, and at 130 px it read as a bib.
//
// So: no collar marks at all. The torso's own neckline, run high and flat, is
// the entire garment, and the zip is what says it closes at the throat. This
// is the "simplify the generic" half of peak shift — the turtleneck was never
// the identity, the jaw and the crop are, and four passes of ink spent below
// the chin were four passes spent on the part nobody reads.

// Two creases on the left, so the four shirts in this project do not read as
// one drawing recoloured.
const CREASES = [
  { p: [[286, 754], [292, 778], [293, 800], [289, 816]], w: [2, 6, 2] },
  { p: [[258, 760], [264, 782], [265, 804], [261, 818]], w: [2, 5, 2] },
];

// The accent: a half-zip hanging off the band. The track starts BELOW the band
// so the two stack instead of crossing, and the pull is the one saturated mark
// on the whole drawing — small, low, and clear of the face.
const ZIP_TRACK = [[380, 606], [381, 622], [380, 638], [380, 652]];
const ZIP_PULL = [[380, 654], [385, 664], [384, 678], [380, 690]];

// ---------------------------------------------------------------------------
// Layers: the same four as peep and wren, same order, same parallax.
// ---------------------------------------------------------------------------
const PARALLAX = { head: 1.0, body: 0.1, features: 1.22, hair: 1.06 };
const LAYERS = ['head', 'body', 'features', 'hair'];
const PIVOT = { x: CX, y: 700 };

// hair parallax 1.06, well under wren's 1.12: a close crop that slides against
// the skull reads as a hairpiece, and the shorter the hair the less slide the
// eye will forgive.
const POSE = {
  leanTravel: 23, leanPivot: { x: PIVOT.x, y: 560 },
  shrugLift: 30, shrugTiltDeg: 1.8, shrugPivot: { x: PIVOT.x, y: 800 },
  yawPx: 27, pitchPx: 16,
  pivot: PIVOT,
  breathSwell: 0.008, swellPivot: { x: CX, y: 950 },
  turnPx: 16,
  layers: LAYERS, parallax: PARALLAX,
  torsoLayers: ['body'],
  units: 1,
};

// ---------------------------------------------------------------------------
// The four specs. This is the whole of what used to be per-face feature code.
// ---------------------------------------------------------------------------

// A wider mouth than the others', to sit under the wider jaw, and the heaviest
// lip band — this face carries more ink everywhere and a thin mouth on it read
// as pursed.
const MOUTH_SOLVE = mouthContour({
  cx: MOUTH.cx, cy: MOUTH.cy, widthBase: 27, widthGain: 32, cornerPx: 24,
  aperture: MOUTH_APERTURE, pressThin: 0.4, pressNeutral: 0,
});

const LIPS = (t, c) => {
  const profile = [2.5 * t, 10 * t, 3 * t, 12 * t * (1 + 0.35 * c.tuck), 2.5 * t];
  return { profile, halfUp: profile[1] / 2, halfLo: profile[3] / 2 };
};

const EYE_DRAW = irisEye(EYE);

// Heavier and flatter than peep's: `up` and `down` equal (no corrugator
// asymmetry authored on this face), and a wide, even profile so a low-set brow
// reads as level rather than as a scowl.
const BROW_GAINS = { up: 15, down: 15, downSkew: 0, inner: 11, angle: 12, bulk: 0 };
const BROW_W = [4, 16, 9];
const BROW = browDeform(BROW_GAINS);

// ---------------------------------------------------------------------------
// Static markup
// ---------------------------------------------------------------------------
const HEAD_FILL = region(HEAD);
const HEAD_RING = taperRing(HEAD, HEAD_W, 10);
const EAR_L_FILL = region(EAR_L), EAR_R_FILL = region(EAR_R);

function markup(id, t) {
  const ink = (d) => `<path d="${d}" fill="${t.ink}"/>`;
  return `
<svg id="${id}" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" xmlns="http://www.w3.org/2000/svg"
     preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%">
  <defs>
    <clipPath id="${id}-clipMouth"><path id="${id}-clipMouthP" d=""/></clipPath>
    <clipPath id="${id}-clipEyeL"><path id="${id}-clipEyeLP" d=""/></clipPath>
    <clipPath id="${id}-clipEyeR"><path id="${id}-clipEyeRP" d=""/></clipPath>
  </defs>

  <!-- head, ears and neck. Ears go under the head fill so only the rim reads.
       Hair underlay at head parallax, same insurance as peep's and wren's. -->
  <g id="${id}-head">
    <path d="${NECK_FILL}" fill="${t.paper}"/>
    ${ink(taper(NECK_L, [3, 8, 6]))}
    ${ink(taper(NECK_R, [3, 8, 6]))}
    <path d="${EAR_L_FILL}" fill="${t.paper}"/>
    <path d="${EAR_R_FILL}" fill="${t.paper}"/>
    ${ink(taper(EAR_L, [3.5, 7, 3.5]))}
    ${ink(taper(EAR_R, [3.5, 7, 3.5]))}
    <path d="${HEAD_FILL}" fill="${t.paper}"/>
    ${ink(HEAD_RING)}
    ${ink(taper(EAR_L_IN, [2.5, 5, 2.5]))}
    ${ink(taper(EAR_R_IN, [2.5, 5, 2.5]))}
    ${ink(taper(JAW_UNDER, [2, 5.5, 2]))}
    <path d="${HAIR_D}" fill="${t.ink}"/>
  </g>

  <!-- turtleneck: silhouette, sleeve seams, collar band, fold, zip, creases -->
  <g id="${id}-body">
    <path d="${region(TORSO)}" fill="${t.paper}"/>
    ${ink(taper(TORSO, TORSO_W))}
    ${ink(taper(SEAM_L, [6, 7, 5]))}
    ${ink(taper(SEAM_R, [6, 7, 5]))}
    ${ink(taper(ZIP_TRACK, [3, 4, 3]))}
    <path d="${taper(ZIP_PULL, [7, 9, 4])}" fill="${t.accent}"/>
    ${CREASES.map((c) => ink(taper(c.p, c.w))).join('\n    ')}
  </g>

  <!-- features: brows, eyes, nose, mouth -->
  <g id="${id}-features">
    <path id="${id}-browL" fill="${t.ink}"/>
    <path id="${id}-browR" fill="${t.ink}"/>
    <g id="${id}-eyes">
      <path id="${id}-eyeL" fill="${t.ink}"/>
      <path id="${id}-eyeR" fill="${t.ink}"/>
      <path id="${id}-apertureL" fill="${t.paper}"/>
      <path id="${id}-apertureR" fill="${t.paper}"/>
      <g clip-path="url(#${id}-clipEyeL)"><circle id="${id}-irisL" fill="${t.ink}"/></g>
      <g clip-path="url(#${id}-clipEyeR)"><circle id="${id}-irisR" fill="${t.ink}"/></g>
    </g>
    <path d="${NOSE_D}" fill="${t.ink}"/>
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
// Renderer. Every line below is plumbing the kit already decided; there is no
// geometry in this function at all.
// ---------------------------------------------------------------------------
let uid = 0;

export function createFace(mount, theme = {}) {
  const t = Object.assign({}, THEME, theme);
  const id = `lark${++uid}`;
  const { svg, $, set } = createFaceShell(mount, id, markup(id, t));

  const el = {
    head: $('head'), body: $('body'), features: $('features'), hair: $('hair'),
    browL: $('browL'), browR: $('browR'),
    eyeL: $('eyeL'), eyeR: $('eyeR'),
    clipEyeL: $('clipEyeLP'), clipEyeR: $('clipEyeRP'),
    apertureL: $('apertureL'), apertureR: $('apertureR'),
    irisL: $('irisL'), irisR: $('irisR'),
    mouthIn: $('mouthIn'), lips: $('lips'), clipMouth: $('clipMouthP'),
    teeth: $('teeth'), teethLo: $('teethLo'), tongue: $('tongue'),
  };

  const EYE_L = { lid: el.eyeL, aperture: el.apertureL, iris: el.irisL, clip: el.clipEyeL };
  const EYE_R = { lid: el.eyeR, aperture: el.apertureR, iris: el.irisR, clip: el.clipEyeR };

  function apply(p) {
    poseTransforms(p, set, el, POSE);

    // The ±1 stagger and the −7/+6 tilts are lark's drawn asymmetry.
    EYE_DRAW(set, EYE_L, { cx: CX - EYE.dx, cy: EYE.y + 1, tilt: -7,
      lid: p.lidL, squint: p.squintL, pupilX: p.pupilX, pupilY: p.pupilY });
    EYE_DRAW(set, EYE_R, { cx: CX + EYE.dx, cy: EYE.y - 1, tilt: 6,
      lid: p.lidR, squint: p.squintR, pupilX: p.pupilX, pupilY: p.pupilY });

    const bL = BROW(BROW_L, p.browRaiseL, p.browAngleL, p.browInnerL);
    const bR = BROW(BROW_R, p.browRaiseR, p.browAngleR, p.browInnerR);
    set(el.browL, 'd', taper(bL.pts, scaleWidths(BROW_W, bL.weight), 6));
    set(el.browR, 'd', taper(bR.pts, scaleWidths(BROW_W, bR.weight), 6));

    const m = MOUTH_SOLVE(p, LIPS);
    const contour = region(m.contour);
    set(el.mouthIn, 'd', contour);
    set(el.clipMouth, 'd', contour);
    set(el.lips, 'd', taperRing(m.contour, m.profile, 12));
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

/** This face as a **Face** record — `{ create, meta }`. */
export const lark = { create: createFace, meta: META };
