/**
 * Avatar: "myna".
 *
 * The third line-art character, authored against a user-supplied reference
 * asset (a raster illustration): a young contemporary Indian woman — wavy
 * shoulder-length dark hair with paper highlight slashes, thin geometric
 * glasses, orange hoop earrings, a white crew tee under an open orange
 * overshirt. Hand-authored geometry with the reference on screen; nothing is
 * traced. Same idiom as peep and wren — no strokes anywhere, every mark a
 * filled taper — and the same 30-channel contract underneath.
 *
 * What is deliberately different from the siblings, and why:
 * - THE HAIR IS A HORSESHOE, NOT A CLOUD. One closed loop: wavy outer
 *   silhouette down to pointed lock tips IN FRONT of both shoulders, then the
 *   inner edge back up the face, joined across the forehead by the fringe
 *   sweep. The enclosed "hole" (face, neck, chest V) opens downward between
 *   the two lock groups, so the region needs no fill-rule tricks.
 * - THE EARS SIT ON THE HAIR. In the reference the mass runs behind the ears,
 *   so ears and hoops are drawn in the hair layer, after the mass. The
 *   head-layer underlay (same loop at head parallax) backfills the ±3-unit
 *   slide between the two layers under yaw — same insurance as peep's, doing
 *   one extra job here.
 * - THE ACCENT IS A GARMENT, not trim (peep) or frames (wren): the overshirt
 *   is two accent-filled panels over a paper tee. Background leaks behind an
 *   orange shirt are loud, which is why the tee runs edge-to-edge under both
 *   panels and everything overshoots the frame.
 * - THE MOUTH HAS LIPS. The proven aperture-contour model, but the ring's
 *   width profile carries a cupid's-bow dip at the top centre and a fuller
 *   lower lip. (An under-lip shadow mark existed through v7; it was deleted —
 *   a mark inside the deformation zone either rides every open perfectly or
 *   it is a defect, and its ink went to the lip band instead.)
 *
 * v8 calibration note: the expressive gains here (brow travel, corner lift,
 * squint, lip weights, the lid mapping) are authored against a 130 px
 * DOWNSAMPLE of the rest/emotion renders, not the close-up — this face ships
 * in a call tile. Slightly theatrical at full size is correct.
 *
 * Like peep, there is no drawn jaw line to drop, so `jaw` has nothing to
 * move — same documented character decision.
 */

import { clamp, lerp } from './params.js';
import {
  f, createFaceShell, faceApi, poseTransforms, pairedTeeth,
} from './face-core.js';
import { taper, taperRing, region } from './line-art.js';

export const THEME = {
  ink: '#191919',
  paper: '#ffffff',
  // The overshirt orange — one key, hoops use it too. ~9% duskier than the
  // asset's sample: at tile size the sampled value out-shouted the face.
  accent: '#dc8432',
  mouthIn: '#191919',
  teeth: '#ffffff',
  tongue: '#8d7f79',
};

// Same native 760x950 art space as the siblings; window lifted like wren's
// because the hair crowns high.
const VB = { x: 92, y: 50, w: 576, h: 800 };

export const META = {
  viewBox: { x: VB.x, y: VB.y, w: VB.w, h: VB.h },
  mouthCrop: { x: 298, y: 436, w: 164, h: 100 },
};

// --- landmarks --------------------------------------------------------------
const CX = 380;
const HEAD_TOP = 150;

const EYE = { y: 386, dx: 56, rx: 15, ry: 16 };
const MOUTH = { cx: CX, cy: 492 };
const MOUTH_APERTURE = 36;

// Lenses: measured off the reference's fully visible left lens, converted by
// face-height fraction (lens height ≈ 0.22 of hairline→chin; w:h ≈ 1.3;
// corner radius ≈ 0.38 of lens height — a soft rect verging on superellipse).
// Centred ON the eye line: the reference pupil sits at lens mid-height, and
// its "just under the brows" top gap is 0.21 of lens height, which lands the
// same way here. Lens centres sit 4 units outboard of the eyes so the bridge
// keeps the reference's narrow 18-unit gap without moving the pupils.
const LENS = { dx: 60, hw: 51, hh: 40, r: 30 };

// Brows: bold, long and clearly arched, with real air between them and the
// frames — the reference's brows are its strongest single mark. The rest
// shape is a gentle taper-arc: v7's outer third dropped 17 units in 15 and
// over a resting smile the kink composited into a smirk that curdled across
// a long session. The kink is still available — as a browAngle POSE.
const BROW_L = [[CX - 22, 340], [CX - 40, 327], [CX - 60, 320], [CX - 76, 319],
                [CX - 88, 322], [CX - 97, 327], [CX - 103, 332]];
// Near-mirrored: the right arch rides 1 unit higher (personality, small
// enough to survive the mirror-flip levelness check, which is judged on the
// glasses and eye lines). Anything bigger read as a baked-in head tilt —
// the mixer's headRoll adds on top of the art and nothing can subtract a
// drawn lean.
const BROW_R = [[CX + 22, 340], [CX + 40, 326], [CX + 60, 319], [CX + 76, 318],
                [CX + 88, 321], [CX + 97, 327], [CX + 103, 332]];

// ---------------------------------------------------------------------------
// Static art: head.
//
// Same three-segment jaw rule as every head here, but the runs are the softest
// of the three rigs: rounded gonion, full cheek, small chin pad slightly off
// the midline. Chin at 568 against wren's 572 and peep's 597 — the shorter
// lower face is most of the "mid twenties" read.
// ---------------------------------------------------------------------------
const HEAD = [
  [CX, HEAD_TOP],
  [452, 149], [518, 206], [522, 288],
  [525, 338], [522, 386], [518, 424],
  [516, 456], [510, 482], [498, 508],
  [484, 530], [452, 556], [422, 566],
  [404, 572], [350, 571], [332, 563],
  [306, 551], [282, 529], [266, 505],
  [252, 479], [246, 453], [250, 423],
  [244, 385], [240, 337], [243, 287],
  [247, 205], [308, 148], [CX, HEAD_TOP],
];
// Lighter than wren's ring by ~20% — the reference line is confident but not
// woodcut. Heavy low on the jaw, nothing at the crown (under hair).
const HEAD_W = [3, 6, 9.5, 12, 13, 11.5, 9, 6, 4, 3];

// Neck: the shared truncated-cone construction, slim; fused into the head
// layer and overshot past every neckline for the standard parallax reasons.
const NECK_FILL =
  'M344 512C336 570 330 620 328 680L328 790L434 790L434 680C432 620 426 570 418 512Z';
const NECK_L = [[344, 530], [338, 580], [333, 634], [331, 720]];
const NECK_R = [[418, 528], [424, 578], [429, 632], [431, 720]];
const JAW_UNDER = [[340, 558], [356, 582], [404, 584], [422, 556]];

// ---------------------------------------------------------------------------
// Static art: hair — the wavy lob.
//
// One closed horseshoe (see header). Waves are S-curves on the outer edge and
// pointed tips at the bottom; the fringe sweeps from a part left of centre
// down across the forehead, bottoming out above the right brow. Interior
// highlight slashes are separate paper marks on top of the mass.
// ---------------------------------------------------------------------------
const HAIR = [
  // left lock tip (in front of the shoulder), then one curl and a smooth
  // outer edge going up — deep or repeated scallops here read as braids,
  // which is what sank the first two drafts
  [252, 712],
  [224, 706], [204, 684], [198, 654],
  [186, 622], [178, 588], [182, 554],
  [172, 520], [168, 480], [176, 444],
  [170, 404], [174, 360], [186, 320],
  [188, 270], [210, 226], [240, 196],
  [258, 158], [296, 130], [336, 114],
  [366, 100], [420, 96], [458, 112],
  [498, 116], [534, 142], [548, 178],
  // outer right, down with the same gentle waves
  [574, 202], [586, 248], [580, 288],
  [594, 326], [594, 382], [582, 418],
  [586, 452], [578, 498], [566, 528],
  [574, 560], [566, 600], [550, 626],
  [556, 648], [540, 674], [516, 686],
  [508, 700], [484, 704], [470, 690],
  // right front lock: inner boundary climbing over the chest to the jaw
  [458, 670], [454, 642], [462, 612],
  [478, 588], [500, 564], [518, 540],
  // right inner edge up the face side to the temple
  [530, 502], [530, 454], [532, 410],
  [532, 382], [524, 358], [510, 346],
  // the fringe hairline, right to left: a HIGH arc — the reference forehead
  // is largely open (brow-to-hairline reads close to brow-to-mouth). The
  // right descent is short, a strand tip dipping to just above the right
  // frame corner; v6 let the arc sag to the brows and the whole upper face
  // went dark
  [500, 344], [494, 322], [488, 298],
  [478, 268], [462, 250], [448, 240],
  [436, 236], [427, 242], [416, 238],
  // …the cleft dips at the part (right of centre, as drawn), then the left
  // branch is one long high swoop to the temple — it must clear the left
  // brow tail entirely, so the descent happens outboard of x≈276
  [398, 236], [376, 242], [352, 252],
  [328, 264], [308, 278], [294, 292],
  [284, 306], [276, 320], [270, 332],
  [264, 344], [258, 356], [256, 366],
  // left inner edge: down the face side, then slanting AWAY from the neck —
  // an edge that hugs the neck makes the side mass a rope
  [250, 392], [244, 432], [248, 478],
  [252, 516], [242, 554], [230, 592],
  [224, 622], [220, 654], [228, 684],
  [236, 700], [244, 708], [252, 712],
];
const HAIR_D = region(HAIR);

// Paper highlight slashes: crescent cuts following the flow. These, plus the
// wavy silhouette, are the contemporary read; without them the mass is a
// helmet whatever its outline does.
// v8: fewer, bolder. Eight slivers flickered during nods — the most-played
// motion in the product — so each side-fall keeps two large crescents instead
// of three ticks, and every survivor gained width. The silhouette, not the
// interior, is the identity feature.
const SHINE = [
  { p: [[330, 150], [300, 168], [280, 196], [272, 228]], w: [2, 7, 2] },
  // the long echo of the fringe sweep — the reference's most prominent slash;
  // it lives in the band ABOVE the hairline, tight to the sweep's direction
  { p: [[468, 220], [446, 196], [416, 176], [382, 166]], w: [1.5, 5.5, 1.5] },
  { p: [[196, 336], [187, 380], [187, 424], [196, 462]], w: [2, 8, 2] },
  { p: [[204, 522], [196, 574], [206, 648], [242, 700]], w: [1.5, 7, 1.5] },
  { p: [[574, 330], [583, 372], [583, 414], [574, 448]], w: [2, 8, 2] },
  { p: [[550, 538], [552, 592], [530, 652], [482, 684]], w: [1.5, 7, 1.5] },
];

// Ears and hoops: painted ON the hair mass (see header). Small C-shapes; the
// hoop is a thin accent ring hanging from the lobe — the reference's one
// piece of jewellery.
const EAR_L = [[246, 404], [224, 396], [212, 418], [216, 446], [222, 468], [240, 474], [250, 464]];
const EAR_R = [[514, 404], [536, 396], [548, 418], [544, 446], [538, 468], [520, 474], [510, 464]];
const EAR_L_IN = [[230, 420], [220, 430], [221, 446], [228, 455]];
const EAR_R_IN = [[530, 420], [540, 430], [539, 446], [532, 455]];

const K = 0.5523;
function circlePts(cx, cy, r) {
  const k = r * K;
  return [
    [cx + r, cy], [cx + r, cy + k], [cx + k, cy + r], [cx, cy + r],
    [cx - k, cy + r], [cx - r, cy + k], [cx - r, cy], [cx - r, cy - k],
    [cx - k, cy - r], [cx, cy - r], [cx + k, cy - r], [cx + r, cy - k],
    [cx + r, cy],
  ];
}
const HOOP_L = taperRing(circlePts(236, 488, 12), [4.5, 5, 4.5]);
const HOOP_R = taperRing(circlePts(524, 488, 12), [4.5, 5, 4.5]);

// ---------------------------------------------------------------------------
// Static art: glasses — thin geometric rounded rectangles in ink.
//
// Wider than tall, corners genuinely rounded, thin ring. Temples run outward
// and vanish under the hair's inner edge. Drawn after the eyes so the frame
// passes over the bean at gaze extremes rather than under it.
// ---------------------------------------------------------------------------
function roundRectPts(cx, cy, hw, hh, r) {
  const k = r * K;
  const L = cx - hw, R = cx + hw, T = cy - hh, B = cy + hh;
  return [
    [R, cy],
    [R, cy + (hh - r) / 2], [R, B - r - k * 0.2], [R, B - r],
    [R, B - r + k], [R - r + k, B], [R - r, B],
    [R - r - (hw - r) / 2, B], [L + r + (hw - r) / 2, B], [L + r, B],
    [L + r - k, B], [L, B - r + k], [L, B - r],
    [L, B - r - k * 0.2], [L, cy + (hh - r) / 2], [L, cy],
    [L, cy - (hh - r) / 2], [L, T + r + k * 0.2], [L, T + r],
    [L, T + r - k], [L + r - k, T], [L + r, T],
    [L + r + (hw - r) / 2, T], [R - r - (hw - r) / 2, T], [R - r, T],
    [R - r + k, T], [R, T + r - k], [R, T + r],
    [R, T + r + k * 0.2], [R, cy - (hh - r) / 2], [R, cy],
  ];
}
const LENS_L = roundRectPts(CX - LENS.dx, EYE.y, LENS.hw, LENS.hh, LENS.r);
const LENS_R = roundRectPts(CX + LENS.dx, EYE.y, LENS.hw, LENS.hh, LENS.r);
const RING_W = [3, 3.4, 3, 3.4, 3];
// Bridge at the upper third and temples off the top outer corners, sweeping
// up toward the ears — both as drawn in the reference.
const BRIDGE = [[CX - 9, 371], [CX - 3, 366], [CX + 3, 366], [CX + 9, 371]];
// Attach on the top-outer corner arc (the rounded corner pulls the rim in to
// ~x±108 at this height), sweeping up to vanish under the hair's inner edge.
const TEMPLE_L = [[CX - 108, 364], [CX - 124, 357], [CX - 141, 352], [CX - 158, 350]];
const TEMPLE_R = [[CX + 108, 364], [CX + 124, 357], [CX + 141, 352], [CX + 158, 350]];

/** The nose: a tiny soft hook, tip only — the glasses own the bridge. It sits
 *  lower than v6 (the reference's nose mark tops out at ~55% of eye→mouth,
 *  not 39%), which is also what gives the taller lenses their clearance. */
const NOSE_D = taper(
  [[CX + 3, 439], [CX - 2, 448], [CX - 6, 456], [CX - 4, 462],
   [CX + 1, 465], [CX + 7, 463], [CX + 10, 458]],
  [1.5, 5.5, 2]
);

// ---------------------------------------------------------------------------
// Static art: torso — white crew tee under an open orange overshirt.
//
// Three fills in order: the tee (paper, edge-to-edge under everything), then
// the two overshirt panels (accent) whose inner edges make the open V. Both
// panels keep the house two-run shoulder: outer arm edge, hard acromion turn,
// near-horizontal trapezius shelf. Everything overshoots the frame.
// ---------------------------------------------------------------------------
const TEE = [
  [288, 960],
  [290, 860], [292, 760], [296, 688],
  [300, 656], [318, 636], [352, 626],
  [364, 623], [396, 623], [408, 625],
  [442, 634], [460, 658], [464, 688],
  [468, 760], [470, 860], [472, 960],
  [410, 960], [348, 960], [288, 960],
];
const TEE_NECK = [[318, 640], [338, 652], [358, 658], [380, 660],
                  [402, 657], [422, 650], [440, 638]];

// The shoulder line sits high — chin to trapezius is ~75 units. v1 had it 60
// lower and the neck read as a column; the reference's neck is short.
const PANEL_L = [
  [302, 960],
  [306, 890], [308, 810], [314, 742],
  [318, 710], [322, 676], [318, 638],
  [298, 634], [264, 644], [232, 656],
  [186, 672], [132, 702], [106, 748],
  [72, 814], [60, 882], [58, 960],
  [180, 960], [240, 960], [302, 960],
];
const PANEL_R = [
  [454, 960],
  [450, 890], [448, 810], [442, 742],
  [438, 710], [434, 676], [438, 636],
  [458, 632], [492, 642], [524, 654],
  [570, 670], [624, 700], [650, 746],
  [684, 812], [696, 882], [698, 960],
  [620, 960], [540, 960], [454, 960],
];

// Ink runs for the panels: outer silhouette from under the collar over the
// shoulder and down the arm; inner run down the open front edge.
const PANEL_L_OUT = [
  [318, 638],
  [298, 634], [264, 644], [232, 656],
  [186, 672], [132, 702], [106, 748],
  [72, 814], [60, 882], [58, 950],
];
const PANEL_L_IN = [[318, 638], [322, 676], [318, 710], [314, 742],
                    [308, 810], [306, 890], [304, 950]];
const PANEL_R_OUT = [
  [438, 636],
  [458, 632], [492, 642], [524, 654],
  [570, 670], [624, 700], [650, 746],
  [684, 812], [696, 882], [698, 950],
];
const PANEL_R_IN = [[438, 636], [434, 676], [438, 710], [442, 742],
                    [448, 810], [450, 890], [452, 950]];
const PANEL_W = [7, 8, 7, 8, 7, 6];

// The collar: a down-pointing folded flap hugging each side of the neck —
// v1's up-pointing lapel triangles read as horns. The lower vertex is a
// single sharp point so the notch against the shoulder reads as tailoring,
// not a blob. Not mirrored; the reference's collar is not symmetric and
// neither is any worn one.
const COLLAR_L = [[338, 600], [316, 604], [298, 624], [288, 648],
                  [296, 672], [310, 686], [324, 662],
                  [330, 640], [335, 618], [338, 600]];
const COLLAR_R = [[424, 598], [446, 602], [464, 622], [474, 646],
                  [466, 670], [452, 684], [438, 660],
                  [432, 638], [427, 616], [424, 598]];

// Folds where the cloth is actually pulled, tapered to nothing at both ends:
// out of the collar roll toward each armpit, and off the shoulder seam down
// the sleeve. Few and curved — v6 scattered short parallel ticks and they
// read as scratches on the garment, not drape.
const CREASES = [
  { p: [[300, 692], [284, 722], [272, 756], [268, 788]], w: [1, 4.5, 1] },
  { p: [[150, 700], [168, 742], [178, 788], [180, 830]], w: [1.5, 5, 1.5] },
  { p: [[118, 742], [134, 776], [143, 810], [144, 838]], w: [1, 3.5, 1] },
  { p: [[464, 690], [478, 722], [488, 758], [491, 792]], w: [1, 4.5, 1] },
  { p: [[610, 698], [594, 740], [585, 786], [586, 828]], w: [1.5, 5, 1.5] },
  { p: [[644, 752], [630, 786], [621, 816], [619, 842]], w: [1, 3.5, 1] },
];

// ---------------------------------------------------------------------------
// Layers: the house four, same order, same roles.
// ---------------------------------------------------------------------------
const PARALLAX = { head: 1.0, body: 0.1, features: 1.22, hair: 1.12 };
const LAYERS = ['head', 'body', 'features', 'hair'];
const PIVOT = { x: CX, y: 700 };

const POSE = {
  leanTravel: 23, leanPivot: { x: PIVOT.x, y: 560 },
  shrugLift: 30, shrugTiltDeg: 1.7, shrugPivot: { x: PIVOT.x, y: 800 },
  // Under peep's 28 for the same reason as wren: a big hair mass at full
  // parallax slides like a wig.
  yawPx: 26, pitchPx: 16,
  pivot: PIVOT,
  breathSwell: 0.008, swellPivot: { x: CX, y: 950 },
  turnPx: 16,
  layers: LAYERS, parallax: PARALLAX,
  torsoLayers: ['body'],
  units: 1,
};

// ---------------------------------------------------------------------------
// Generators: mouth — the proven aperture-contour model with myna's lips.
//
// See face-peep.js for the full derivation (aperture-not-centreline, the 0.18
// ramp, 3:1 downward opening, the 0.75 cubic solve). Myna's additions: a
// 9-stop ring profile whose top centre dips (the cupid's bow) and whose lower
// centre swells (the fuller lip), and an under-lip shadow drawn off the
// contour bottom in apply().
// ---------------------------------------------------------------------------
// v8: both bands up ~15% from v7 — at a 130 px tile the closed smile was
// merely *present*; the floor raise is what makes it read as smiling there.
const LIP_UP = 10.5; // upper lip band thickness at its fullest
const LIP_LO = 15;   // lower lip band at centre

function mouthGeometry(p) {
  const cx = MOUTH.cx;
  const cy = MOUTH.cy;
  const open = clamp(p.mouthOpen);
  const round = clamp(p.mouthRound);
  const tuck = clamp(p.mouthTuck);
  const press = clamp(p.mouthPress);

  const w = (28 + clamp(p.mouthWidth) * 30) * (1 - 0.36 * round);

  // Press changes SHAPE, not just weight. A bilabial closure (viseme A,
  // press .55) must render as a pressed band — corners neutralized, bow
  // scallop ironed flat, thickness nearly kept — or A is indistinguishable
  // from idle X and lipsync reads mushy however good the timing is. The
  // pressed band is the anchor viewers use to verify sync.
  const t = 1 - 0.18 * press;
  // Nine stops around the ring: s=0 left corner, 0.25 top centre, 0.5 right
  // corner, 0.75 bottom centre. The dip at 0.25 is the bow notch (a close-up
  // detail, deliberately light); press irons it up to band thickness.
  const bow = lerp(5, LIP_UP * 0.92, clamp(press * 1.6));
  const lo = LIP_LO * t * (1 + 0.35 * tuck);
  const profile = [
    3 * t, LIP_UP * t, bow * t, LIP_UP * t, 3.5 * t,
    11.5 * t, lo, 11.5 * t, 3 * t,
  ];
  const halfUp = (LIP_UP * t) / 2;
  const halfLo = lo / 2;

  const h = open * MOUTH_APERTURE;
  const k = clamp(open / 0.18);

  // Corner travel 28 (was 23): the tile swallows less. Press straightens the
  // band by pulling the corner lift toward zero.
  const cLift = 1 - 0.85 * press;
  const yL = cy - (1.5 + p.mouthCornerL * 28) * cLift;
  const yR = cy - (1.5 + p.mouthCornerR * 28) * cLift;

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

/** peep's dental-arch teeth, myna's width factors. */
function teethPath(m, amt, lower) {
  if (amt < 0.01) return '';
  const gap = m.innerBot - m.innerTop;
  if (gap < 2) return '';
  const tw = m.w * (lower ? 0.6 : 0.76);
  const cap = lower ? 0.5 : 0.5 + 0.35 * m.tuck;
  const th = Math.min(amt * (lower ? 13 : 20), gap * cap);

  if (lower) {
    const base = m.innerBot + 8;
    const edge = m.innerBot - th;
    const end = m.innerBot - th * 0.35;
    return (
      `M${f(m.cx - tw)} ${f(base)}L${f(m.cx + tw)} ${f(base)}` +
      `L${f(m.cx + tw * 0.92)} ${f(end)}` +
      `Q${f(m.cx)} ${f(2 * edge - end)} ${f(m.cx - tw * 0.92)} ${f(end)}Z`
    );
  }
  const top = m.innerTop - 8;
  const edge = m.innerTop + th;
  const end = m.innerTop + th * 0.35;
  return (
    `M${f(m.cx - tw)} ${f(top)}L${f(m.cx + tw)} ${f(top)}` +
    `L${f(m.cx + tw * 0.92)} ${f(end)}` +
    `Q${f(m.cx)} ${f(2 * edge - end)} ${f(m.cx - tw * 0.92)} ${f(end)}Z`
  );
}

// Eyes: the bean model, near-round — the reference's pupils are big and dark
// and do most of the face's expressive work with the lashes.

/** Top-lid height for a given lid value — shared by bean and lash so they can
 *  never disagree. The mapping is a 0.6-power, not linear: the mixer's rest
 *  lid is 0.12 (params.js: real neutral eyes graze the iris) and on beans
 *  this big a linear map spent only 7% of the travel by then — rest rendered
 *  as a wide-eyed stare, a long-session comfort failure. The power curve
 *  spends ~28% by 0.12 (a visible flat on the bean top: attentive-relaxed,
 *  not sleepy) while a true wide (curious sends lid −0.10 → clamps to ~0)
 *  still rounds fully open, and closed is unchanged. */
function lidTopY(cy, lid) {
  return lerp(cy - EYE.ry * 1.05, cy - EYE.ry * 0.42, Math.pow(clamp(lid), 0.6));
}

function eyePath(cx, cy, lid, squint, tiltDeg) {
  const L = clamp(lid);
  const topY = lidTopY(cy, lid);
  // Squint gain .95 (was .7): the smile-squint is most of what separates warm
  // from neutral at tile size.
  const botY = lerp(cy + EYE.ry * 1.05, cy - EYE.ry * 0.05, L) - clamp(squint) * EYE.ry * 0.95;
  const rx = EYE.rx;
  const a = (tiltDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const R = (x, y) => {
    const dx = x - cx, dy = y - cy;
    return `${f(cx + dx * ca - dy * sa)} ${f(cy + dx * sa + dy * ca)}`;
  };
  return (
    `M${R(cx - rx, cy)}` +
    `C${R(cx - rx * 0.5, topY)} ${R(cx + rx * 0.5, topY)} ${R(cx + rx, cy)}` +
    `C${R(cx + rx * 0.5, botY)} ${R(cx - rx * 0.5, botY)} ${R(cx - rx, cy)}Z`
  );
}

/**
 * The upper lash line: lies ON the bean's top edge and ends in a small
 * outward flick at the outer corner. The body samples the bean's own top
 * cubic (controls at ±rx/2, topY, so y(u) = 3u(1−u)·(topY−cy)) rather than
 * approximating it — v6 floated a straight slash near the lens top and it
 * read as a second, angrier brow inside the glasses. Same lid value as the
 * bean, so a blink carries the lash down with the closing lid; the flick is
 * anchored at the corner, which the lid never moves.
 * `dir` is −1 for the left eye (flick outward-left), +1 for the right.
 */
function lashPath(cx, cy, lid, dir) {
  const topY = lidTopY(cy, lid);
  const rx = EYE.rx;
  const at = (u) => {
    const v = 1 - u;
    const x = v * v * v * -rx + 3 * v * v * u * -rx * 0.5
            + 3 * v * u * u * rx * 0.5 + u * u * u * rx;
    // Proud of the edge by 1.5 so the liner shows against the dark bean.
    return [cx + dir * x, cy + 3 * v * u * (topY - cy) - 1.5];
  };
  const pts = [
    at(0.3), at(0.5), at(0.7), at(0.88), at(1),
    [cx + dir * (rx + 5), cy - 4.5],
    [cx + dir * (rx + 9), cy - 9],
  ];
  return taper(pts, [2.5, 4, 3, 1.5], 6);
}

// Brows: the point-list deformation. Travel is ASYMMETRIC by design:
// - Raises land at 20 (v7: 16) — the minimal-face lesson says small deltas
//   vanish, and at a 130 px tile the emotion poses collapsed below this.
// - Descent is capped at 8.5 and weighted toward the inner half (corrugator
//   pull). The cap is the frame-clearance envelope: the arch points that sit
//   over the lens's top bar (y≈319–322 at rest) must keep ≥3.5 units of air
//   above the bar's ink at browRaise −1, or the brow merges with the frame
//   and brows-down — concentration — silently dies. The inner weighting also
//   keeps the outer tail off the frame's corner arc. What travel can't carry,
//   thickness does: a knitted brow bulks up 30% at full descent.
function browPath(pts, raise, angle, inner) {
  const n = pts.length - 1;
  const up = Math.max(0, raise);
  const dn = Math.max(0, -raise);
  const out = pts.map(([x, y], i) => {
    const u = i / n;
    return [x, y - up * 20 + dn * 8.5 * (1 - 0.45 * u)
             - inner * 15 * (1 - u) - angle * 16 * u];
  });
  const wk = 1 + 0.3 * dn;
  return taper(out, [3 * wk, 12 * wk, 4 * wk], 6);
}

// ---------------------------------------------------------------------------
// Static markup
// ---------------------------------------------------------------------------
const HEAD_FILL = region(HEAD);
const HEAD_RING = taperRing(HEAD, HEAD_W, 10);

function markup(id, t) {
  const ink = (d) => `<path d="${d}" fill="${t.ink}"/>`;
  const paper = (d) => `<path d="${d}" fill="${t.paper}"/>`;
  return `
<svg id="${id}" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" xmlns="http://www.w3.org/2000/svg"
     preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%">
  <defs><clipPath id="${id}-clipMouth"><path id="${id}-clipMouthP" d=""/></clipPath></defs>

  <!-- head and neck; hair underlay at head parallax is the anti-sliver
       insurance AND the backfill behind the hair-layer ears (see header). -->
  <g id="${id}-head">
    <path d="${NECK_FILL}" fill="${t.paper}"/>
    ${ink(taper(NECK_L, [3, 7, 5]))}
    ${ink(taper(NECK_R, [3, 7, 5]))}
    <path d="${HEAD_FILL}" fill="${t.paper}"/>
    ${ink(HEAD_RING)}
    ${ink(taper(JAW_UNDER, [2, 5, 2]))}
    <path d="${HAIR_D}" fill="${t.ink}"/>
  </g>

  <!-- tee, then the two overshirt panels and their tailoring -->
  <g id="${id}-body">
    ${paper(region(TEE))}
    ${ink(taper(TEE_NECK, [3, 5.5, 3]))}
    <path d="${region(PANEL_L)}" fill="${t.accent}"/>
    <path d="${region(PANEL_R)}" fill="${t.accent}"/>
    ${ink(taper(PANEL_L_OUT, PANEL_W))}
    ${ink(taper(PANEL_R_OUT, PANEL_W))}
    ${ink(taper(PANEL_L_IN, [6, 7, 5]))}
    ${ink(taper(PANEL_R_IN, [6, 7, 5]))}
    <path d="${region(COLLAR_L)}" fill="${t.accent}"/>
    <path d="${region(COLLAR_R)}" fill="${t.accent}"/>
    ${ink(taperRing(COLLAR_L, [3, 4.5, 3], 6))}
    ${ink(taperRing(COLLAR_R, [3, 4.5, 3], 6))}
    ${CREASES.map((c) => ink(taper(c.p, c.w))).join('\n    ')}
  </g>

  <!-- features: brows, eyes+lashes, nose, glasses, mouth -->
  <g id="${id}-features">
    <path id="${id}-browL" fill="${t.ink}"/>
    <path id="${id}-browR" fill="${t.ink}"/>
    <g id="${id}-eyes">
      <path id="${id}-eyeL" fill="${t.ink}"/>
      <path id="${id}-eyeR" fill="${t.ink}"/>
      <path id="${id}-lashL" fill="${t.ink}"/>
      <path id="${id}-lashR" fill="${t.ink}"/>
    </g>
    <path d="${NOSE_D}" fill="${t.ink}"/>
    ${ink(taperRing(LENS_L, RING_W, 6))}
    ${ink(taperRing(LENS_R, RING_W, 6))}
    ${ink(taper(BRIDGE, [3, 4, 3]))}
    ${ink(taper(TEMPLE_L, [3, 3.5, 4]))}
    ${ink(taper(TEMPLE_R, [3, 3.5, 4]))}
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

  <!-- hair: the mass, its highlights, then ears and hoops on top -->
  <g id="${id}-hair">
    <path d="${HAIR_D}" fill="${t.ink}"/>
    ${SHINE.map((s) => paper(taper(s.p, s.w, 6))).join('\n    ')}
    <path d="${region(EAR_L)}" fill="${t.paper}"/>
    <path d="${region(EAR_R)}" fill="${t.paper}"/>
    ${ink(taper(EAR_L, [3, 6, 3]))}
    ${ink(taper(EAR_R, [3, 6, 3]))}
    ${ink(taper(EAR_L_IN, [2, 4, 2]))}
    ${ink(taper(EAR_R_IN, [2, 4, 2]))}
    <path d="${HOOP_L}" fill="${t.accent}"/>
    <path d="${HOOP_R}" fill="${t.accent}"/>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Renderer — the invariant apply() shape; only the travels and the extra lip
// marks are myna's own.
// ---------------------------------------------------------------------------
let uid = 0;

export function createFace(mount, theme = {}) {
  const t = Object.assign({}, THEME, theme);
  const id = `myna${++uid}`;
  const { svg, $, set } = createFaceShell(mount, id, markup(id, t));

  const el = {
    head: $('head'), body: $('body'), features: $('features'), hair: $('hair'),
    browL: $('browL'), browR: $('browR'),
    eyes: $('eyes'), eyeL: $('eyeL'), eyeR: $('eyeR'),
    lashL: $('lashL'), lashR: $('lashR'),
    mouthIn: $('mouthIn'), lips: $('lips'),
    clipMouth: $('clipMouthP'),
    teeth: $('teeth'), teethLo: $('teethLo'), tongue: $('tongue'),
  };

  function apply(p) {
    poseTransforms(p, set, el, POSE);

    // Re-derived for the big lenses: outboard the bean edge at full travel is
    // still ~24 units clear of the rim (56+14+15 vs the 109-unit interior
    // edge), inboard ~16; vertically the 38-unit half-interior leaves ~15.
    // Past these the pupil starts reading pressed against the frame.
    set(el.eyes, 'transform', `translate(${f(p.pupilX * 14)} ${f(p.pupilY * 10)})`);

    const lidFollow = Math.max(0, p.pupilY) * 0.22;
    const lidL = p.lidL + lidFollow;
    const lidR = p.lidR + lidFollow;
    // Both beans exactly on EYE.y: a ±1 stagger here read as head tilt at
    // rest, and rest must be level (see BROW_R).
    set(el.eyeL, 'd', eyePath(CX - EYE.dx, EYE.y, lidL, p.squintL, -3));
    set(el.eyeR, 'd', eyePath(CX + EYE.dx, EYE.y, lidR, p.squintR, 3));
    set(el.lashL, 'd', lashPath(CX - EYE.dx, EYE.y, lidL, -1));
    set(el.lashR, 'd', lashPath(CX + EYE.dx, EYE.y, lidR, 1));

    set(el.browL, 'd', browPath(BROW_L, p.browRaiseL, p.browAngleL, p.browInnerL));
    set(el.browR, 'd', browPath(BROW_R, p.browRaiseR, p.browAngleR, p.browInnerR));

    const m = mouthGeometry(p);
    const contour = region(m.contour);
    set(el.mouthIn, 'd', contour);
    set(el.clipMouth, 'd', contour);
    set(el.lips, 'd', taperRing(m.contour, m.profile, 12));
    // Keyed off the drawn gap, not mouthOpen — grey is a rendering fault on a
    // two-value face (peep's F bug).
    set(el.mouthIn, 'opacity', f(clamp((m.innerBot - m.innerTop) / 3)));

    pairedTeeth(p, set, el, teethPath, m);

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
export const myna = { create: createFace, meta: META };
