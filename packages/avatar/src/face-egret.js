/**
 * Avatar: "egret".
 *
 * The fifth line-art character, and the first authored REFERENCE-FIRST against
 * the shared kit (docs/authoring-a-face.md § The staged process, stage 0). The
 * reference is a stakeholder-supplied line drawing of a woman on a video call:
 * high top-knot bun, hair swept up tight to the skull, strong straight brows,
 * full lips, a long oval face, and a blazer with notched lapels over a
 * scoop-neck top.
 *
 * Distillate — the marks that carry the identity, in the order they survive
 * shrinking:
 *   1. THE BUN. A ball riding proud of the crown, 0.21 of head height above
 *      it. It is the whole silhouette and the only thing still legible at a
 *      thumbnail; everything else is a face.
 *   2. THE SWEPT-UP HAIR. Tight to the skull, no loose sides, EARS EXPOSED —
 *      which is what says the mass on top is deliberate rather than a crop.
 *   3. THE NOTCHED LAPELS. A blazer, not a shirt: the notch between collar and
 *      lapel is the one shape no other torso in this project has.
 *   4. A LONG OVAL FACE. Measured w:h 0.61 against peep's ~0.71.
 *   5. WIDE-SET EYES. Centres 0.53 of face width apart against peep's 0.41.
 * Proportions were measured off the bitmap, not eyeballed: brow, eye, nose and
 * mouth all sit at their measured fraction of face height below the hairline
 * (0.239 / 0.383 / 0.670 / 0.789).
 *
 * THREE DELIBERATE DIVERGENCES FROM THE REFERENCE, all stage-1 judgement:
 * - NO GLASSES. Requested. It is not a subtraction: the eye TYPE follows from
 *   it. face-eyes.js's rule is that a bean can only carry gaze against a fixed
 *   frame, and taking the frames away removes the only one this face had — so
 *   this is an `irisEye`, like peep, and not wren's bean.
 * - THE HAIR IS SOLID INK, where the reference outlines it and fills it with
 *   strand lines. Outlined hair has no silhouette at 130 px and the head would
 *   read bald; a solid mass keeps the bun, which is identity mark #1. The
 *   strand detail comes back as myna's device — paper shine cut into the ink —
 *   which reads at full size and vanishes gracefully.
 * - NO ACCENT COLOUR. The reference is pure black and white and this drawing
 *   honours that. `accent` stays in THEME because hosts read the key off
 *   `api.theme`, but nothing in the markup spends it. Theme keys are per-avatar
 *   (CLAUDE.md), so a face that declines the family's one colour is legal — and
 *   here it is the reference's most obvious instruction.
 *
 * NOT YET STAGE 2. Production calibration at 130 px — emotion-pose gains,
 * resting brow and mouth for trust, mouth ink floor, clearance at worst-case
 * composites — has not been done. The reference is still the bar.
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
  ink: '#171717',
  paper: '#ffffff',
  // Declared for hosts that paint around the widget; deliberately unspent.
  accent: '#f97415',
  mouthIn: '#171717',
  teeth: '#ffffff',
  tongue: '#8d7f79',
};

// The BUN is the visible crown, not the skull — same call wren makes for its
// curl cloud. Measured: the bun rides 0.21 of head height above the skull.
const FRAME = { centerX: 380, crownY: 76, chinY: 590 };
const VB = viewBoxForHead(FRAME);

export const META = {
  viewBox: { x: VB.x, y: VB.y, w: VB.w, h: VB.h },
  mouthCrop: { x: 300, y: 472, w: 160, h: 94 },
};

// --- landmarks, all measured off the reference ------------------------------
const CX = FRAME.centerX;
const SKULL_TOP = 160;
const CHIN_Y = 590;

// Wide-set (dx 68 against peep's 55) and slightly wider than tall, which is the
// shape an aperture can be cut from — see face-eyes.js.
const EYE = {
  y: 386, dx: 68, rx: 17, ry: 15, lidPow: 1, squintGain: 0.7, lidFollow: 0.22,
  aperture: { x: 3.0, top: 5.5, bot: 4.5 },
  irisR: 8.0,
  irisTravel: { x: 4.5, y: 2.2 },
};
const NOSE_TOP = 402;
const MOUTH = { cx: CX, cy: 520 };
// Only 70 units of chin below the mouth against peep's 109, because the
// reference's mouth sits low on a short chin. The aperture is bounded by that,
// not by taste: at 30 the dark ends ~28 below the mouth centre and still leaves
// 40 units of jaw under it.
const MOUTH_APERTURE = 30;

// Brows: strong and nearly straight, the reference's most forceful mark after
// the bun, set 47 units above the eye line. Drawn control points per the peep
// correction — an arch is not recoverable from its endpoints.
const BROW_L = [[CX - 22, 344], [CX - 44, 337], [CX - 64, 333], [CX - 82, 332],
                [CX - 96, 334], [CX - 106, 338], [CX - 112, 344]];
const BROW_R = [[CX + 24, 342], [CX + 46, 335], [CX + 66, 331], [CX + 83, 330],
                [CX + 96, 332], [CX + 105, 336], [CX + 110, 342]];

// ---------------------------------------------------------------------------
// Static art: head — a long oval, w:h 0.61.
//
// The three-segment jaw rule still holds, but this is the softest of the five:
// the gonion barely turns, and the run from cheekbone to chin is one long
// taper. That taper IS the face shape — it is what a measured 0.61 looks like
// against peep's 0.71, and it is doing more identity work than any feature.
// ---------------------------------------------------------------------------
const HEAD = [
  [CX, SKULL_TOP],
  [440, 164], [492, 202], [502, 258],
  [508, 306], [511, 346], [509, 384],
  [506, 420], [500, 452], [489, 482],
  [477, 512], [452, 552], [420, 572],
  [404, 583], [356, 584], [334, 572],
  [304, 554], [280, 514], [268, 482],
  [258, 452], [252, 420], [249, 384],
  [247, 346], [250, 306], [256, 258],
  [266, 202], [318, 164], [CX, SKULL_TOP],
];
const HEAD_W = [3.5, 6, 9, 12, 13, 11.5, 9, 6, 4, 3.5];

// Ears: exposed, because the hair is swept up. That is identity mark #2 and it
// is the whole reason this file has ear geometry where wren has none.
const EAR_L = [[252, 372], [228, 362], [212, 386], [218, 420], [224, 448], [246, 458], [258, 448]];
const EAR_R = [[508, 372], [532, 362], [548, 386], [542, 420], [536, 448], [514, 458], [502, 448]];
const EAR_L_IN = [[236, 390], [226, 400], [225, 418], [232, 432]];
const EAR_R_IN = [[524, 390], [534, 400], [535, 418], [528, 432]];

const NECK_FILL =
  'M334 546C326 596 320 640 318 700L318 790L442 790L442 700C440 640 434 596 426 546Z';
const NECK_L = [[334, 556], [328, 600], [322, 650], [320, 750]];
const NECK_R = [[426, 552], [432, 598], [437, 648], [440, 750]];
const JAW_UNDER = [[336, 566], [354, 596], [408, 598], [426, 564]];

// ---------------------------------------------------------------------------
// Static art: hair — swept up, plus the bun.
//
// Two pieces, and the split matters. The SWEEP is one closed loop like wren's
// cloud, but with the lobe rhythm taken out entirely: the outer edge hugs the
// skull about 8 units proud, because hair pulled back has no volume at the
// sides — that tightness is what makes the mass on top read as deliberate. The
// hairline runs high and almost straight, which is the other half of it.
//
// The BUN is a separate circle so it can sit proud of the sweep and be given
// its own shine. It overlaps the sweep by ~40 units, so the two fuse into one
// ink mass with no seam to line up.
// ---------------------------------------------------------------------------
const HAIR = [
  [258, 332],
  [250, 300], [248, 264], [254, 232],
  [262, 200], [284, 176], [312, 162],
  [340, 148], [368, 142], [394, 144],
  [424, 146], [458, 164], [478, 192],
  [494, 216], [502, 248], [504, 282],
  [506, 308], [506, 326], [504, 342],
  // back along the hairline, right to left: high and nearly straight
  [498, 308], [492, 282], [476, 266],
  [458, 250], [428, 242], [398, 244],
  [386, 245], [374, 245], [362, 246],
  [336, 250], [308, 260], [290, 278],
  [276, 292], [266, 310], [262, 328],
  [260, 330], [259, 331], [258, 332],
];
const HAIR_D = region(HAIR);

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
// Sat 4 units left of the midline. A bun dead on centre reads as machine
// output, the same reason every head here has an off-centre chin.
const BUN = circlePts(CX - 4, 150, 74);
const BUN_D = region(BUN);

// Paper cut into the ink — myna's device. Two marks: a crescent on the bun's
// upper left where the light lands, and a short wrap at its base that reads as
// the tie without any geometry for one.
const BUN_SHINE = [[330, 128], [342, 102], [366, 88], [392, 88]];
// A second, shorter arc low on the bun. The first pass ran a full WRAP across
// the bun's base to read as the tie, and at any size it read as a scratch —
// a long thin paper mark on ink is a scratch, and only a short curved one is a
// highlight. The tie is not drawn at all now; the bun's own silhouette says it.
const BUN_LOW = [[336, 186], [352, 198], [374, 202], [392, 198]];
// One sweep line on the skull, short and following the pull-back direction.
const SWEEP_SHINE = [[300, 262], [318, 240], [342, 224], [366, 216]];

/** The nose: straighter and narrower than any of the others', which is the
 *  reference exactly — a long bridge and a small tip, not peep's hook. */
const NOSE_D = taper(
  [[CX - 3, NOSE_TOP], [CX - 9, 434], [CX - 14, 458], [CX - 9, 472],
   [CX - 2, 480], [CX + 10, 478], [CX + 16, 469]],
  [2, 7.5, 3]
);

// ---------------------------------------------------------------------------
// Static art: torso — a blazer with notched lapels over a scoop-neck top.
//
// Identity mark #3, and the one piece of this drawing that is genuinely a new
// garment rather than a variation. The notch is the point: a blazer's collar
// and its lapel are two edges that STOP short of each other, and the gap
// between them is the whole silhouette. Draw them as one continuous line and it
// is a cardigan.
//
// Only ~150 units of torso are inside the camera, so everything below is sized
// to read in that band: the lapels are wide, the notch sits high, and the
// scoop neckline is shallow.
// ---------------------------------------------------------------------------
const TORSO = [
  [30, 950],
  [34, 846], [80, 724], [168, 690],
  [228, 676], [282, 656], [320, 632],
  [340, 686], [420, 686], [440, 630],
  [480, 656], [534, 678], [594, 692],
  [682, 724], [726, 846], [730, 950],
];
const TORSO_W = [10, 11, 9, 8.5, 11, 10];

const SEAM_L = [[170, 692], [148, 758], [152, 852], [166, 950]];
const SEAM_R = [[592, 690], [614, 756], [610, 850], [598, 950]];

// The lapel fold — from the neck down to the button. This is the edge of the
// opening, and the V it makes with its mirror is what says "jacket".
const LAPEL_FOLD_L = [[332, 620], [316, 668], [300, 716], [288, 766]];
const LAPEL_FOLD_R = [[434, 618], [450, 666], [466, 714], [478, 766]];
// The collar's lower edge, running out from the neck. It STOPS at the notch.
const COLLAR_L = [[332, 620], [312, 634], [292, 646], [276, 656]];
const COLLAR_R = [[434, 618], [454, 632], [474, 644], [490, 654]];
// …and the lapel's outer edge picks up BELOW and OUTSIDE that stop. The gap
// between the two is the notch, and it is drawn by not drawing anything.
const LAPEL_OUT_L = [[262, 672], [252, 706], [246, 738], [242, 766]];
const LAPEL_OUT_R = [[504, 670], [514, 704], [520, 736], [524, 766]];

// THE TORSO'S OWN NECKLINE IS THE TOP, and there is exactly one arc across the
// throat. The first pass drew two — the blazer's neckline behind the neck AND a
// separate scoop below it — and two concentric arcs under a jaw read as a
// choker over a neckline however far apart they are. The same lesson lark's
// collar took four passes to teach, arriving here on the second: under a chin,
// draw one line or none.

// Creases on the left, so the five torsos here do not read as one drawing
// recoloured. A blazer creases at the lapel roll, not across the chest.
const CREASES = [
  { p: [[214, 730], [222, 760], [226, 792], [224, 820]], w: [2, 6, 2] },
  { p: [[186, 742], [193, 770], [196, 798], [194, 822]], w: [2, 5, 2] },
];

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------
const PARALLAX = { head: 1.0, body: 0.1, features: 1.22, hair: 1.06 };
const LAYERS = ['head', 'body', 'features', 'hair'];
const PIVOT = { x: CX, y: 720 };

// yawPx 25 and hair parallax 1.06, both under wren's: the bun is the largest
// single mass in the project and the more of it there is, the less slide
// against the skull the eye will forgive before it reads as a wig.
const POSE = {
  leanTravel: 23, leanPivot: { x: PIVOT.x, y: 570 },
  shrugLift: 30, shrugTiltDeg: 1.8, shrugPivot: { x: PIVOT.x, y: 820 },
  yawPx: 25, pitchPx: 16,
  pivot: PIVOT,
  breathSwell: 0.008, swellPivot: { x: CX, y: 960 },
  turnPx: 16,
  layers: LAYERS, parallax: PARALLAX,
  torsoLayers: ['body'],
  units: 1,
};

// ---------------------------------------------------------------------------
// The four specs — the whole of this face's feature configuration.
// ---------------------------------------------------------------------------

// myna's press law, because this mouth has myna's problem: a defined cupid's
// bow has to IRON FLAT under press or viseme A and idle X draw the same line.
// Half-width 42 at rest, which is the measurement: the reference's mouth spans
// 0.325 of face width and this face is 264 units across. The first pass built
// it at 0.25 by eye and the whole lower face read gaunt for it — the mouth was
// too small to balance a chin this long, and it was the mouth that was wrong,
// not the chin.
const MOUTH_SOLVE = mouthContour({
  cx: MOUTH.cx, cy: MOUTH.cy, widthBase: 28, widthGain: 34, cornerPx: 24,
  aperture: MOUTH_APERTURE, pressThin: 0.18, pressNeutral: 0.85,
});

// Nine stops, because the reference has a real cupid's bow: s=0 left corner,
// 0.25 top centre, 0.5 right corner, 0.75 bottom centre, and the dip at 0.25 is
// the bow notch. The lower lip is fuller than the upper, which is the
// reference's most-noticed mouth property after the bow.
const LIP_UP = 10.5;
const LIP_LO = 14;
const LIPS = (t, c) => {
  const bow = 4.5 + (LIP_UP * 0.92 - 4.5) * clamp(c.press * 1.6);
  const lo = LIP_LO * t * (1 + 0.35 * c.tuck);
  return {
    profile: [
      3 * t, LIP_UP * t, bow * t, LIP_UP * t, 3.5 * t,
      11 * t, lo, 11 * t, 3 * t,
    ],
    halfUp: (LIP_UP * t) / 2,
    halfLo: lo / 2,
  };
};

// An IRIS eye, and the rule decided it rather than taste: the glasses are gone,
// so nothing in this drawing gives a solid bean a fixed frame to travel
// against. See face-eyes.js.
const EYE_DRAW = irisEye(EYE);

/**
 * The upper lash. The reference's lids are its most worked feature after the
 * brows, and a lash line is the cheapest way to carry that. It rides the lid's
 * own top control point — which `irisEye` hands back — so a blink takes the
 * lash down with the closing lid and the two can never disagree.
 * `dir` is −1 for the viewer's-left eye, +1 for the right.
 */
function lashPath(cx, cy, g, dir) {
  const topY = g.ctlTop;
  const rx = EYE.rx;
  const at = (u) => {
    const v = 1 - u;
    const x = v * v * v * -rx + 3 * v * v * u * -rx * 0.5
            + 3 * v * u * u * rx * 0.5 + u * u * u * rx;
    return [cx + dir * x, cy + 3 * v * u * (topY - cy) - 1.5];
  };
  return taper(
    [at(0.3), at(0.5), at(0.7), at(0.88), at(1),
     [cx + dir * (rx + 5), cy - 5], [cx + dir * (rx + 9), cy - 10]],
    [2.5, 4, 3, 1.5], 6
  );
}

// Strong brows: a raise travels further than a descent, the descent is weighted
// toward the inner half, and the mark bulks as it falls. That is myna's law
// with this face's numbers — the reference's brows are heavy enough to want it.
const BROW_GAINS = { up: 17, down: 12, downSkew: 0.35, inner: 13, angle: 14, bulk: 0.2 };
const BROW_W = [4, 16, 7];
const BROW = browDeform(BROW_GAINS);

// ---------------------------------------------------------------------------
// Static markup
// ---------------------------------------------------------------------------
const HEAD_FILL = region(HEAD);
const HEAD_RING = taperRing(HEAD, HEAD_W, 10);
const EAR_L_FILL = region(EAR_L), EAR_R_FILL = region(EAR_R);

function markup(id, t) {
  const ink = (d) => `<path d="${d}" fill="${t.ink}"/>`;
  const paper = (d) => `<path d="${d}" fill="${t.paper}"/>`;
  return `
<svg id="${id}" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" xmlns="http://www.w3.org/2000/svg"
     preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%">
  <defs>
    <clipPath id="${id}-clipMouth"><path id="${id}-clipMouthP" d=""/></clipPath>
    <clipPath id="${id}-clipEyeL"><path id="${id}-clipEyeLP" d=""/></clipPath>
    <clipPath id="${id}-clipEyeR"><path id="${id}-clipEyeRP" d=""/></clipPath>
  </defs>

  <!-- head, ears and neck. Ears under the head fill so only the rim reads.
       Hair underlay at head parallax, the same insurance the others carry. -->
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
    <path d="${BUN_D}" fill="${t.ink}"/>
    <path d="${HAIR_D}" fill="${t.ink}"/>
  </g>

  <!-- blazer: silhouette, sleeve seams, lapels with their notch, scoop, creases -->
  <g id="${id}-body">
    <path d="${region(TORSO)}" fill="${t.paper}"/>
    ${ink(taper(TORSO, TORSO_W))}
    ${ink(taper(SEAM_L, [6, 7, 5]))}
    ${ink(taper(SEAM_R, [6, 7, 5]))}
    ${ink(taper(LAPEL_FOLD_L, [7, 9, 6]))}
    ${ink(taper(LAPEL_FOLD_R, [7, 9, 6]))}
    ${ink(taper(COLLAR_L, [5, 7, 5]))}
    ${ink(taper(COLLAR_R, [5, 7, 5]))}
    ${ink(taper(LAPEL_OUT_L, [5, 7, 6]))}
    ${ink(taper(LAPEL_OUT_R, [5, 7, 6]))}
    ${CREASES.map((c) => ink(taper(c.p, c.w))).join('\n    ')}
  </g>

  <!-- features: brows, eyes, lashes, nose, mouth -->
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
      <path id="${id}-lashL" fill="${t.ink}"/>
      <path id="${id}-lashR" fill="${t.ink}"/>
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

  <!-- hair: the bun and the sweep, with the paper shine cut back into them -->
  <g id="${id}-hair">
    <path d="${BUN_D}" fill="${t.ink}"/>
    <path d="${HAIR_D}" fill="${t.ink}"/>
    ${paper(taper(BUN_SHINE, [2.5, 5, 2]))}
    ${paper(taper(BUN_LOW, [2, 4, 1.5]))}
    ${paper(taper(SWEEP_SHINE, [2, 4, 1.5]))}
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Renderer. No feature arithmetic anywhere below.
// ---------------------------------------------------------------------------
let uid = 0;

export function createFace(mount, theme = {}) {
  const t = Object.assign({}, THEME, theme);
  const id = `egret${++uid}`;
  const { svg, $, set } = createFaceShell(mount, id, markup(id, t));

  const el = {
    head: $('head'), body: $('body'), features: $('features'), hair: $('hair'),
    browL: $('browL'), browR: $('browR'),
    eyeL: $('eyeL'), eyeR: $('eyeR'),
    clipEyeL: $('clipEyeLP'), clipEyeR: $('clipEyeRP'),
    apertureL: $('apertureL'), apertureR: $('apertureR'),
    irisL: $('irisL'), irisR: $('irisR'),
    lashL: $('lashL'), lashR: $('lashR'),
    mouthIn: $('mouthIn'), lips: $('lips'), clipMouth: $('clipMouthP'),
    teeth: $('teeth'), teethLo: $('teethLo'), tongue: $('tongue'),
  };

  const EYE_L = { lid: el.eyeL, aperture: el.apertureL, iris: el.irisL, clip: el.clipEyeL };
  const EYE_R = { lid: el.eyeR, aperture: el.apertureR, iris: el.irisR, clip: el.clipEyeR };

  function apply(p) {
    poseTransforms(p, set, el, POSE);

    // Both eyes exactly on EYE.y — the reference's are level, and a ±1 stagger
    // on a face this wide-set reads as a head tilt at rest.
    const gL = EYE_DRAW(set, EYE_L, { cx: CX - EYE.dx, cy: EYE.y, tilt: -4,
      lid: p.lidL, squint: p.squintL, pupilX: p.pupilX, pupilY: p.pupilY });
    const gR = EYE_DRAW(set, EYE_R, { cx: CX + EYE.dx, cy: EYE.y, tilt: 4,
      lid: p.lidR, squint: p.squintR, pupilX: p.pupilX, pupilY: p.pupilY });
    set(el.lashL, 'd', lashPath(CX - EYE.dx, EYE.y, gL, -1));
    set(el.lashR, 'd', lashPath(CX + EYE.dx, EYE.y, gR, 1));

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
    set(el.tongue, 'ry', '7');
    set(el.tongue, 'opacity', tg > 0.02 ? '1' : '0');
  }

  return faceApi(mount, svg, apply, t);
}

/** This face as a **Face** record — `{ create, meta }`. */
export const egret = { create: createFace, meta: META };
