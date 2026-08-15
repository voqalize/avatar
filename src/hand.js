/**
 * hand — a hand at the frame edge, drawn the way a webcam sees one.
 *
 * The avatar has no arms (CLAUDE.md, constraint 9): two earlier rigs carried a
 * full forearm/hand chain, nine parameter channels and several hundred lines of
 * geometry each, and it was removed on sight. This is the other design. It
 * survived a stakeholder trial and was promoted on 2026-08-07; what makes it a
 * different proposition from the thing that was cut is that **it is not part of
 * the rig**. No parameter channel, no per-face
 * geometry, no forearm — one drawing, placed by four numbers derived from the
 * mounted avatar's own `META.viewBox`, painted in its own theme, appended over
 * its SVG. A face that never plays a gesture is byte-for-byte what it was.
 *
 * The four rules the drawing obeys, all of them earned by rendering something
 * that broke them:
 *
 * 1. THE WRIST NEVER ENTERS THE FRAME (`WRIST_DROP`). Every gesture is posed by
 *    wrist position, and the wrist is pinned below the viewBox bottom at all
 *    times, so the hand is always CUT by the frame edge and never ends in a
 *    stump hanging in mid-air. Each shape is drawn with a long tail below the
 *    wrist that is clipped away; the ink outline is an OPEN mark that runs off
 *    the bottom rather than a closed ring, so there is no line across the
 *    bottom to give the crop away. This is also why there is no arm to draw: a
 *    hand entering from off-camera implies the arm for free, and an arm drawn
 *    is an arm that has to be posed.
 *
 * 2. THE HAND IS BIG, because it is nearer the lens than the face and because
 *    once only fingers clear the edge, the fingers carry the whole read. How
 *    big is a depth question, not a style one, and gestures differ: a thumbs-up
 *    is pushed toward the lens, a wave is thrown out to the side and further
 *    away. `REACH` sets the near case and each gesture's `sc` steps back.
 *
 * 3. WHAT RISES PAST THE MOUTH IS ONLY EVER A DIGIT. Mouth sync is the headline
 *    feature (constraint 2), so a gesture that covers the mouth is a regression
 *    whatever else it does. The high gestures drift outboard as they rise, so
 *    at mouth height the only thing in front of the face is one finger. At true
 *    webcam scale an open palm is 65% of the frame's width, which cannot be got
 *    out of the way by moving it sideways — rule 4 forbids that much travel. So
 *    the waves sit LOWER and further back instead (`sc`), and the face stays
 *    entirely clear.
 *
 * 4. THE ONLY EDGE THAT CUTS THE HAND IS THE BOTTOM ONE. Every shipped avatar's
 *    viewBox is a portrait window pillarboxed inside a 16:9 tile, so anything
 *    past the window's right edge is sliced by a hard vertical line that reads
 *    as a rendering fault. Outboard travel is budgeted against the hand's own
 *    width AND its rotation — a hand 440 units tall swings ~110 units sideways
 *    at 14 degrees, which is what silently blew the budget the first time.
 *    `checkHandFraming()` asserts both rules against the real timelines.
 *
 * See docs/internal-mixer.md § Hand gestures for the wire surface and
 * docs/authoring-a-face.md § The hand for what a face module owes this module
 * (the answer is: a viewBox and two theme keys).
 */

import { taper, taperRing, region, smooth } from './line-art.js';
import { f } from './face-core.js';

// --- the frame --------------------------------------------------------------
// Everything the hand needs to place itself comes out of `META.viewBox`, and
// that is the whole reason this module needed no new META field. The three
// shipped avatars draw a 576x800 portrait window; the numbers below are ratios
// and offsets against that window, not against any one character's anatomy.
//
// The wrist sits below the frame edge by a clear margin, never at it: a wrist
// exactly on the line renders as a rounded end kissing the border, which reads
// as a hand stuck to the frame rather than one coming from off-camera.
const WRIST_DROP = 24;   // minimum units the wrist stays below the frame bottom
const HIDE = 574;        // fully off-camera; must clear the tallest shape
// How far the outermost ink may sit from the frame centre before the portrait
// window slices it (rule 4): half the window, less a hair of margin.
const SIDE_MARGIN = 8;
// Author scale at a 576-unit-wide window. The number this design changed most,
// and both directions were rendered and judged. Earlier cuts drew the hand at
// FACE depth: a 19 cm hand against a 23 cm head is 0.83 of it, peep's head is
// 477 art units, so ~394 — which came out looking like a pale tube rising past
// the collar, because it is the wrong depth. A hand raised to a webcam sits
// roughly 40 cm from the lens with the face at 60, so it images about 1.5x
// larger: 3.4 is the optically honest scale.
//
// 3.4 was then walked back, and the argument that pulled it back is not the
// optical one. It put the palm at ~1.05 head-widths, which is true — but at the
// 130 px acceptance size the viewer gets ONE GLANCE, and the largest brightest
// mass in the tile becomes its subject. When that mass is an information-free
// white slab the composition inverts: the hand becomes the figure and the head
// becomes ground, and the tile reads as broken before it reads as a gesture.
// Optically correct, perceptually wrong. 2.95 puts the palm at ~0.82
// head-widths — still clearly nearer the lens, still clearly not the subject.
// Compact avatar tiles need a hand that reads as a gesture, not as the subject.
const REACH_AT_576 = 2.40;

/** The four placement numbers, derived. A host never sees these. */
function frameOf(viewBox) {
  const vb = viewBox;
  return {
    cx: vb.x + vb.w / 2,           // frame centre; also where a resting hand starts
    bottom: vb.y + vb.h,           // the visible bottom edge — the line the hand rises past
    reach: (REACH_AT_576 * vb.w) / 576,
    outboardLimit: vb.w / 2 - SIDE_MARGIN,
  };
}

// --- geometry ---------------------------------------------------------------
// Author units: wrist at (0,0), fingers up (-y), thumb toward -x. Points below
// are ON-CURVE and get run through `smooth()`; the +300 tails are the part the
// frame eats. One hand is drawn and mirrored for the other side (see `dir`).
//
// Two hand FAMILIES, and no gesture blurs them. A wave shows the palm; a
// thumbs-up necessarily shows the back of the hand, and the first version of
// this drawing used one shape for both — which is why nothing read. Built from
// only the cues that survive 130 px:
//
//            palmar (palm to camera)        dorsal (back to camera)
//   webs     smooth, shallow U              bumpy knuckle row
//   base     wide soft-cornered heel        straighter, narrower
//   thumb    out and clear of the fingers   crossing IN FRONT of the fist
//   interior one thenar crease              no crease; a curl line instead
//
// Cut because none of them survive the acceptance size: finger creases, tendon
// lines, knuckle bulges on extended fingers, fingernails.

// --- palmar: the open hand, for waving --------------------------------------
// Three finger masses, not four: the ring and little fingers are one shape.
// That is standard caricature economy and it costs nothing in read — measured
// on an earlier cut, two of the finger gaps shrank to under a pixel at 130 px
// and fused, which is what turned the wave into a smear. Every white gap here
// is at least as wide as the ink beside it at the acceptance size.
const PALM = [
  // Ulnar edge. The tail NARROWS toward the frame cut — the single cheapest fix
  // in the whole drawing. Every earlier hand widened as it approached the
  // bottom edge, which reads as a shape RESTING ON the edge (a bag, a sheet of
  // paper) rather than one continuing past it. Widest at ~a third down from the
  // fingertips, ~65% of that at the cut, and the eye infers the arm for free.
  [24, 300], [26, 58], [30, 18], [38, -18], [42, -48],
  [39, -72], [31, -86], [21, -84],
  [17, -104], [8, -116], [-4, -114], [-13, -102], [-16, -84],
  [-22, -102], [-34, -111], [-46, -104], [-53, -91], [-53, -76],
  // The thumb is a CONVEX WEDGE, and that is a deletion rather than an
  // addition. An earlier thumb had a re-entrant curl in its outer contour; at
  // 130 px the hook read as a detached ear sitting beside the jaw, which was the
  // single most confusing mark in the set. There is no concavity anywhere in
  // this contour: it leaves the palm's outer edge, swells to a rounded pad at
  // ~40 degrees off the palm axis, and comes back. A thumb is a wedge, and a
  // wedge has two edges.
  [-68, -73], [-80, -64], [-84, -52], [-80, -40],
  [-68, -31], [-56, -22], [-47, -5], [-41, 28], [-34, 300],
];
// Where the finger information moved to. An earlier cut put the interdigital
// valleys 50-60% of the way down the fingers, which makes a SAW: at 130 px a
// deep-notched silhouette reads as a crown or a claw, never as a hand. Real
// fingers are not separated at the silhouette, they are separated by short
// creases in the flesh. So the notches came up to ~15% and these marks took
// over the job — thick at the notch floor, tapered to nothing over about a
// third of the finger's length, in exactly the mark language of peep's own ear
// whorl and nose hook.
// There are exactly TWO, because three finger masses have two gaps between
// them. A third mark hinting at the ring/little split was drawn and removed: at
// 130 px it carries no information (the split it implies is invisible at any
// size this ships at) and at full size it reads as a scratch. Economy is not a
// style here, it is the difference between a mark and a blemish.
const PALM_SEPS = [
  [[10, -94], [10, -89], [11, -84]],
  [[-20, -94], [-21, -89], [-21, -84]],
];
// The one interior mark that says PALM rather than back-of-hand — and it is the
// THENAR crease, the arc around the ball of the thumb, not a line across the
// palm. That is the change a person drawing a hand makes without thinking about
// it, and the earlier horizontal version is why: a wide shallow smile low in a
// rounded white form, at tile size, beside a face, reads as a MOUTH. The arc
// runs off the bottom edge instead of ending, so nothing about it says "this
// mark stopped here".
const PALM_CREASE = [[-53, -65], [-46, -47], [-34, -27], [-18, -8]];

// --- dorsal: the fist, for thumbs-up ----------------------------------------
// The back of a closed hand: an undulating top edge of metacarpal heads, and a
// base that is straighter and narrower than the palmar heel. No palm crease — a
// crease here would say palm.
//
// The knuckle row sits higher than anatomy alone would put it, and deliberately.
// Rule 1 keeps the wrist below the frame, so only the TOP of the fist is ever on
// screen — and the thumb's proportion is read against the VISIBLE mass, not
// against the whole hand. At an anatomically honest knuckle height two thirds of
// the fist was off-camera, which left a correct thumb looking as long as
// everything it was attached to. Raising the row to 0.56 of hand length puts the
// ratio back where the eye expects it.
//
// The visible fist must also be WIDER THAN TALL. Drawn 75 wide against 90 tall
// above the frame cut it was not a fist, it was a tower — and a crest that
// ramped monotonically to a single spike at the index knuckle was its steeple.
// The crest is now a gentle arc, still highest toward the index side because
// that is true, but by 16 units across 60 rather than by 30; the mass is 82 wide
// against 78 visible. The two undulations survive only as inflections in it.
const FIST = [
  [24, 300], [26, 62], [30, 20], [39, -7], [45, -31],
  [42, -51], [31, -64], [14, -70], [-4, -69],
  [-21, -63], [-35, -51], [-42, -31], [-40, -6],
  [-35, 62], [-31, 300],
];
// Four small knuckle bumps were drawn at the same scale and rhythm as peep's
// hair spikes, so at 130 px the row read as a lapel zigzag continuing the
// collar — the fist stopped being a hand and became clothing. Two large soft
// undulations carry the same information (this mass is knuckled, therefore it is
// a closed hand) without colliding with a mark the character already owns.
//
// One interior mark, and only one. The dorsal fist was an empty mitten: a big
// white slab with all its information in the outline, which is the definition of
// clip art. A single S-curve for the curled proximal phalanges is the only
// interior mark that earns its ink at the acceptance size. Not four knuckle
// lines — one.
// It runs PARALLEL to the knuckle crest, about 24 units under it, which is where
// the proximal phalanges actually are — and, drawn any lower, it sat near the
// frame cut and left the knuckle half of the fist empty. An empty top and a
// marked bottom is upside down: the eye goes to the crest first, and finds
// nothing there.
const FIST_CURL = [[22, -43], [7, -50], [-10, -49], [-25, -41]];
// The thumb is a SEPARATE CLOSED SHAPE crossing the fist, which is what keeps
// the middle-finger read dead — the first thumbs-up drawn here was rejected on
// sight for exactly that. A glyph has tolerances and these are them:
//   - within 8 degrees of VERTICAL. Leaning it outboard to get away from the
//     middle finger's axis reads as a corner of the mass rather than a digit;
//   - the part clearing the crest is 32 wide by 42 tall — about square, which is
//     the emoji's proportion and the whole reason this does not read as
//     ONE_MOMENT at 130 px. Longer and thinner is a finger; much stubbier and it
//     disappears into the silhouette;
//   - width ~1.4x a finger's;
//   - THE BASE IS INSIDE THE MASS, NOT BESIDE IT. This is the load-bearing one.
//     Two attempts put the thumb on the flank — once as a long lozenge that
//     detached into a second object, once as an egg tangent to the knuckles that
//     read as a raised finger — and the diagnosis both times was the same. A
//     thumb whose base sits outside the fist's silhouette is not a thumb, it is
//     a NEIGHBOUR. Its base is buried across 32 units of the crest;
//   - a NOTCH ON BOTH SIDES, and both SHALLOW. The notch floor is what makes a
//     thumb a thumb instead of a corner, but a deep notch is what re-detaches
//     it. Both contours cross the crest within a few units of it.
// It is drawn UNDER the fist (see `build`), and that order is the whole trick.
// Painted on top, the thumb's closed shape runs unbroken from the frame edge to
// its tip and the entire radial column reads as ONE very long digit — the
// middle-finger silhouette, rebuilt out of correct parts.
const FIST_THUMB = [
  [17, -42], [8, -61], [2, -78], [-8, -90],
  [-21, -90], [-31, -80], [-33, -66], [-27, -52],
  [-16, -41], [17, -42],
];
// There is no thumbnail, and that is the clearest single deletion in this
// drawing. A short curved crease near the top of the thumb, at 130 px, on a
// rounded white form beside a face: it read as a CLOSED EYE. The tile had two
// faces in it.

// --- dorsal: index up, for "one moment" -------------------------------------
// The same fist back, with the index extended. It is the fist's silhouette that
// separates this from THUMBS_UP at a glance: a long straight digit rising well
// above the knuckles, against a short fat one clearing them by half. This is the
// gesture that passed review first and changed least — it is the reference the
// other three were rebuilt toward, and the reasons it works are the whole
// lesson: it stands against the BACKGROUND rather than against the shirt, its
// meaning lives in one unambiguous silhouette rather than in notches, and where
// it crosses the hair, value does the separating.
const POINT = [
  [24, 300], [26, 62], [30, 20], [39, -7], [44, -29],
  [37, -49], [17, -53], [8, -66], [6, -107],
  [0, -128], [-11, -136], [-23, -130], [-29, -116], [-29, -72],
  // The index. It once cleared the knuckles by 75 units against a visible fist
  // of 90 — anatomically defensible, and at 0.79 of a head-width it was the
  // longest single mark in the tile. Nothing that is not the face gets to be
  // that. It now clears by 56 against 78, which is what a person reads as a
  // raised finger rather than as a pole; the long-thin-against-short-fat
  // contrast with THUMBS_UP survives on the ratio (0.36 against 0.76), which is
  // where it was always doing its work.
  //
  // It tapers toward the tip and carries no joint pinch. The pinch was drawn in
  // the OUTLINE, and a wobble that small in a contour does not read as a knuckle
  // at any size — it reads as an unsteady line.
  // The thumb, clamped across the curled fingers and showing as a lobe on the
  // flank. An index-up fist with no thumb anywhere in it is quietly impossible.
  [-39, -55], [-42, -31], [-40, -6], [-35, 62], [-31, 300],
];

// Ink weights are in ART units, sampled off peep's own marks: the torso runs
// 8-11, the head peaks at 17 but its face contour sits at 10-12. An earlier cut
// ran a near-constant 14 all the way round, which made the hand both the
// heaviest and the only untapered mark in the picture — the review's diagnosis
// for why it read as a sticker composited over a drawing.
//
// So the profile carries a light direction, upper-left as the faces already
// imply: thin across the fingertips (s in the middle of the mark), thick down
// the two tails where the hand is nearest the camera and furthest from the
// light. Widths are NOT scaled with `reach` — perspective makes the hand bigger,
// not the pen wider.
//
// The whole profile is heavier than it looks like it should be, and that is the
// fix for a hand that would not sit in front of the shirt. The nearest object in
// the frame was carrying the lightest line in the frame: peep's jaw contour runs
// 10-12 and the hand peaked at 13, so the drawing said "behind" while the
// geometry said "in front", and the eye believes the drawing. This is device 2
// of the three a two-colour inker has for a white form crossing a white form
// (compose so it doesn't cross; weight hierarchy; knockout) and it is the one
// already native to these rigs, whose head contour outweighs the brow which
// outweighs the ear whorl.
const W_OUTLINE = [12, 11, 8, 6, 8, 11, 12];
// Device 3, the knockout: a white halo that breaks the shirt's seams where the
// hand crosses them. It is deliberately NARROW across the middle of the mark:
// the hand's upper half sits against the background, and a white rim there would
// turn it into a cut-out sticker. Only the tails — the part over the shirt — get
// the full gap. Where the halo width equals the ink width it is entirely covered
// and costs nothing, so the profile is scaled with the ink above it.
const W_HALO = [26, 22, 13, 6, 13, 22, 26];
const W_CREASE = [2, 8, 2];
// The palm's finger separators: thick where they leave the notch floor, gone by
// the end. This is the ear-whorl mark language, applied to a hand.
const W_SEP = [5, 2, 0.5];
// The fist's one interior mark. Thick-to-thin across an S, so it reads as a form
// turning rather than as a drawn line.
const W_CURL = [3, 9, 7, 2];
const W_THUMB = [9, 11, 9, 7, 9, 11, 9];

// The shapes, and the interior marks each one carries. Interior marks carry
// their own width profile rather than sharing one: three of them exist, they do
// three different jobs, and a separator drawn at crease weight is a crease.
const SHAPES = {
  PALM: {
    outline: PALM,
    marks: [{ pts: PALM_CREASE, w: W_CREASE }, ...PALM_SEPS.map((p) => ({ pts: p, w: W_SEP }))],
    rings: [],
  },
  FIST: {
    outline: FIST,
    marks: [{ pts: FIST_CURL, w: W_CURL }],
    rings: [{ pts: FIST_THUMB }],
  },
  // The index-up fist gets the same single curl, shortened: its extended digit
  // already carries the read, so the mark is only there to stop the mass below
  // being an empty slab.
  POINT: {
    outline: POINT,
    marks: [{ pts: [[20, -42], [5, -48], [-11, -47]], w: W_CURL }],
    rings: [],
  },
};
const shapePoints = (name) => {
  const s = SHAPES[name];
  return [s.outline, ...s.marks.map((m) => m.pts), ...s.rings.map((r) => r.pts)].flat();
};
// Half the heaviest mark, so the framing check measures ink rather than
// centreline. In art units at reach 1 it would be meaningless; it is applied in
// frame units alongside the scaled geometry.
const INK_HALF = 9;

// --- timelines --------------------------------------------------------------
// Channels: `out` (outward offset from frame centre, art units — the sign is
// applied by `dir`), `dy` (how far the wrist sits BELOW the frame's bottom edge,
// so a timeline is portable between avatars whose windows differ), `rot`
// (degrees about the wrist). Keys are [ms, value] with smoothstep between.
// Timings are baked so every gesture reads with no audio at all (constraint 5).
//
// Every gesture starts at out=0: the hand comes up from the middle, from
// wherever it was resting, and finds its position on the way. Nothing teleports
// to the side and then rises, which is what an arc-less rig looks like.
//
// Three animation habits every timeline has, each of them added after a review
// found it missing:
//   - the rise OVERSHOOTS its hold by ~8% and settles back over ~110 ms. A hand
//     that stops dead on the frame it arrives reads as a sprite being placed;
//   - the hold BREATHES. Pixel-identical holds for four and five frames running
//     read as a frozen render, not as stillness;
//   - the exit leaves on a different path from the entry — straighter down and
//     angled toward the body, because that is what dropping a hand looks like.
//
// And the whole set was re-timed shorter on the note "it is a bit slower and it
// lingers a bit longer than I'd think". Three separable faults, because a
// gesture is a rise, a hold and an exit and they were each wrong differently:
//
//   THE RISE eased in AND out, over 420-470 ms, which is a lift, not a throw.
//   A hand entering frame is ballistic: it leaves fast and brakes late. The
//   first key sits at ~55% of the travel in ~150 ms, so most of the distance is
//   gone before the eye catches up, and the last 45% is the brake. Same
//   argument as gaze.js's ballistic head-follow — the STOP is what says the
//   movement arrived somewhere on purpose.
//
//   THE HOLD was ~1 s on all four, which is why they lingered. The hold only
//   has to be long enough to be read, and a gesture the viewer has already read
//   is a gesture standing in front of the face for no reason. Waves hold only as
//   long as the swings take; THUMBS_UP holds 750 ms; ONE_MOMENT keeps the
//   longest hold of the four because buying time IS its job.
//
//   THE EXIT decelerated into the frame edge, so the hand sank rather than
//   dropped. A released hand accelerates away, so the exit covers <20% of its
//   travel in its first third. It is also the shortest of the three phases: you
//   take longer to raise a hand than to let it fall.
//
// Wave rate is 2.8-3.0 Hz. 2-3 Hz is the social wave band; the bottom of it
// reads as tired, and the swing is the only part of a wave that carries the
// word "hi". BYE stays the slower and wider of the two, and buys its extra
// weight with a FOURTH swing rather than with a longer hold — which is the
// difference between a farewell and a stall.
//
// `face` names the interjection clip the mixer plays with the hand. It is not
// decoration: a hand rising to the jaw while the shoulders and head sit
// perfectly still is not attached to anybody. Those clips already exist in
// interjections.js and already move head, brows, shoulders and torso — the hand
// is the missing half of a gesture the rig has always half-played.
//
// `sc` is the gesture's DEPTH, multiplying `reach` about the wrist. One number,
// and it is the difference between a wave and a hand held up to the lens: you
// push a thumbs-up toward the camera and you throw a wave out to the side, so
// the waves render at 0.70 and everything else at 1. Without it the palm — the
// widest shape in the set — covered the whole face at every height it could
// legally occupy, which is a mouth-sync regression, i.e. a hard no.
export const HAND_GESTURES = {
  // Wave. Out and up along an arc, three swings, gone. The peak puts the
  // fingertips a third of the frame height above the bottom edge, which is
  // where a webcam wave sits — so the hand passes the neck and shoulder, never
  // the face.
  //
  // The swing is deliberately ASYMMETRIC, -2 out and +16 in. A wave rotating
  // about a wrist below the frame throws the fingertips ~110 units sideways,
  // and spending that outboard is what put the thumb through the portrait
  // window the first time. Swinging further toward the person you are waving at
  // is also, conveniently, what people do.
  GESTURE_GREET: {
    id: 'GESTURE_GREET', label: 'greet', shape: 'PALM', face: 'GESTURE_GREET', dur: 1250, sc: 0.70,
    out: [[0, 0], [150, 74], [300, 114], [1000, 114], [1250, 30]],
    dy: [[0, HIDE], [150, 240], [300, 40], [390, 60], [700, 50], [1000, 58], [1120, 136], [1250, HIDE]],
    rot: [[0, -3], [150, 2], [310, 16], [475, -2], [640, 16], [805, -1], [970, 12], [1000, 8], [1250, -3]],
  },
  // Goodbye: same hand, slower, one more swing, and it lingers at the top
  // before dropping. A wave that leaves as briskly as it arrived reads as a
  // dismissal rather than a farewell.
  GESTURE_GOODBYE: {
    id: 'GESTURE_GOODBYE', label: 'goodbye', shape: 'PALM', face: 'GESTURE_GREET', dur: 1550, sc: 0.70,
    out: [[0, 0], [170, 76], [320, 116], [1300, 116], [1550, 32]],
    dy: [[0, HIDE], [160, 230], [320, 32], [410, 54], [700, 42], [1000, 52], [1300, 46], [1420, 128], [1550, HIDE]],
    rot: [[0, -3], [170, 2], [330, 16], [510, -2], [690, 16], [870, -2], [1050, 16], [1230, -1], [1300, 8], [1550, -3]],
  },
  // Thumbs-up: straight up the middle, drifting outboard, and it stops at the
  // JAW rather than the nose. A fist-with-thumb-up reaches ~0.76 of a hand's
  // length from the wrist; pin the wrist below the frame edge as rule 1
  // requires and nose height is unreachable without drawing the thumb longer
  // than a middle finger — which is exactly what the rejected version did and
  // exactly why it read the way it did. The wrist spends the entire budget (it
  // sits on the floor), so the fist rides the bottom edge and only the thumb is
  // up near the face.
  GESTURE_APPROVE: {
    id: 'GESTURE_APPROVE', label: 'approve', shape: 'FIST', face: 'GESTURE_APPROVE', dur: 1300, sc: 0.82,
    out: [[0, 0], [160, 54], [300, 84], [1050, 84], [1300, 32]],
    dy: [[0, HIDE], [160, 174], [300, 24], [390, 42], [700, 34], [1050, 40], [1160, 120], [1300, HIDE]],
    rot: [[0, -6], [160, -2], [300, 3], [400, 0], [700, 1.5], [1000, 0], [1050, 0], [1300, -8]],
  },
  // One moment: index up, and then almost still. The hold is the signal — any
  // real sway during it turns a "wait" into a wave, so the drift here is a
  // couple of units and a degree, which reads as a held hand rather than as a
  // stopped clock. Held longest of the four, because it is the one gesture
  // whose job is to buy time (research-perception.md §1, latency masking).
  GESTURE_WAIT: {
    id: 'GESTURE_WAIT', label: 'wait', shape: 'POINT', face: 'GESTURE_WAIT', dur: 1700, sc: 0.78,
    out: [[0, 0], [170, 60], [320, 96], [1400, 96], [1700, 34]],
    dy: [[0, HIDE], [170, 244], [320, 32], [410, 54], [700, 46], [1100, 53], [1400, 48], [1520, 136], [1700, HIDE]],
    rot: [[0, -7], [170, -2], [320, 2], [420, 0], [800, 1], [1200, -0.5], [1400, 0], [1700, -9]],
  },
};

export const HAND_GESTURE_IDS = Object.keys(HAND_GESTURES);

/** Public renderer-frame gesture names → current SVG timelines. */
const FRAME_GESTURES = Object.freeze({
  greet: 'GESTURE_GREET',
  farewell: 'GESTURE_GOODBYE',
  approve: 'GESTURE_APPROVE',
  wait: 'GESTURE_WAIT',
});
const GESTURE_TO_FRAME = Object.freeze(Object.fromEntries(
  Object.entries(FRAME_GESTURES).map(([name, id]) => [id, name]),
));

/** Stable SVG-action names → renderer-neutral hand controls. */
export const HAND_ACTION_TO_FRAME_GESTURE = Object.freeze({
  ...GESTURE_TO_FRAME,
});

// GO_ON is deliberately absent, and this is the reasoning rather than an
// oversight. It was drawn as a low splayed open palm rocking at the wrist; the
// stakeholder's verdict was "go on doesn't work for me" and the review was
// blunter — a black comb with no baseline. Three reasons it cannot be tuned into
// shape in this idiom:
//   - a splayed palm facing camera is the universal STOP sign, so the drawing
//     fights the meaning before the motion starts;
//   - held low and cut by the edge, only the fingers clear the frame, so there
//     is no hand identity to fall back on;
//   - a real "go on" is a FINGER CURL, and this idiom has no way to curl a
//     finger — the shape is static and only position and rotation animate.
// The one design that might work is a fingers-together PALM-UP hand scooping
// along its own axis, which is the invite register rather than the stop one. It
// is unbuilt on purpose: "keep going" is a backchannel, it fires every time the
// user pauses, and a hand entering the frame that often is a cost the message
// does not justify. The face carries it well — `GO_ON` and `GO_ON_ARM` survive
// as face-only interjections and are untouched by this module.

const smoothstep = (t) => t * t * (3 - 2 * t);

function sample(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
    }
  }
  return last[1];
}

// --- the layer --------------------------------------------------------------

/**
 * Mount the hand over a face and return the player. Built by `createAvatar`;
 * the public avatar composes it through a semantic `GESTURE_*` action.
 *
 * @param {SVGElement} svg    the mounted face's own root — same coordinate space
 * @param {{ink:string, paper:string}} theme  the mounted face's palette
 * @param {{viewBox:{x:number,y:number,w:number,h:number}}} meta
 * @param {{dir?: number}} [opts]  dir +1 puts the hand on the viewer's right
 *   (the avatar gesturing with its left hand), -1 on the viewer's left. Both are
 *   anatomically real — the thumb always splays outward, away from the body — so
 *   this is a choice of which hand the character uses, not a mirroring bug.
 */
export function createHand(svg, theme, meta, opts = {}) {
  const fr = frameOf(meta.viewBox);
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  // Appended last, so the hand is in front of everything. It is the nearest
  // object in the frame; anything else would be a depth lie.
  svg.appendChild(g);

  let dir = opts.dir === -1 ? -1 : 1;

  const ink = (d) => `<path d="${d}" fill="${theme.ink}"/>`;
  const pap = (d) => `<path d="${d}" fill="${theme.paper}"/>`;
  const scaled = (pts) => smooth(pts.map(([x, y]) => [x * fr.reach, y * fr.reach]));

  // Paint order per shape, and each layer earns its place:
  //   halo   white, wider than the ink, and only at the tails — it breaks the
  //          shirt's seams where the hand crosses them so the two whites do not
  //          run together (an early hand dissolved into the shirt);
  //   fill   the closed contour, tail and all;
  //   ink    the SAME contour as an OPEN mark, so it runs off the bottom edge
  //          instead of drawing a lid across the wrist.
  // The rings (the thumb) go UNDER all of it — see FIST_THUMB. Painted
  // underneath, the fist's fill swallows the thumb's base and its halo opens a
  // white gap at the crossing, so the thumb emerges from the flank exactly as
  // far as it should: about half the fist's height, and no further.
  const build = ({ outline, marks, rings }) => {
    const el = document.createElementNS(NS, 'g');
    const pts = scaled(outline);
    el.innerHTML =
      rings.map((r) => {
        const rp = scaled(r.pts);
        return pap(region(rp)) + ink(taperRing(rp, W_THUMB));
      }).join('') +
      pap(taper(pts, W_HALO)) +
      pap(region(pts)) +
      ink(taper(pts, W_OUTLINE)) +
      marks.map((m) => ink(taper(scaled(m.pts), m.w))).join('');
    el.style.display = 'none';
    g.appendChild(el);
    return el;
  };
  const shapes = {};
  for (const [k, s] of Object.entries(SHAPES)) shapes[k] = build(s);

  let current = null; // { def, start }
  const queue = [];
  let lastT = 0;

  function place(x, y, rot, sc) {
    // scale(-dir) mirrors the drawing so the thumb always points AWAY from the
    // body, whichever side the hand is on; `sc` is the gesture's depth, and
    // scaling about the wrist origin leaves the wrist where the timeline put it.
    g.setAttribute('transform',
      `translate(${f(x)} ${f(y)}) scale(${f(-dir * sc)} ${f(sc)}) rotate(${f(rot)})`);
  }
  function park() {
    for (const s of Object.values(shapes)) s.style.display = 'none';
    place(fr.cx, fr.bottom + HIDE, 0, 1);
  }
  function show(def) {
    for (const [k, s] of Object.entries(shapes)) s.style.display = k === def.shape ? '' : 'none';
  }
  function applyFrame(frame) {
    if (!frame) { park(); return; }
    const id = FRAME_GESTURES[frame.gesture];
    const def = HAND_GESTURES[id];
    if (!def) { park(); return; }
    dir = frame.side === 'left' ? -1 : 1;
    show(def);
    const local = Math.max(0, Math.min(1, frame.progress)) * def.dur;
    place(
      fr.cx + dir * sample(def.out, local),
      fr.bottom + sample(def.dy, local),
      sample(def.rot, local),
      def.sc || 1,
    );
  }
  park();

  return {
    get playing() { return !!current; },
    get id() { return current ? current.def.id : null; },
    /** The semantic hand control for the current animation frame, or null. */
    get frame() {
      if (!current) return null;
      return {
        gesture: GESTURE_TO_FRAME[current.def.id],
        progress: Math.max(0, Math.min(1, (lastT - current.start) / current.def.dur)),
        side: dir === -1 ? 'left' : 'right',
      };
    },
    /** Render a first-class AvatarFrame hand control. */
    applyFrame,
    setDir(d) { dir = d === -1 ? -1 : 1; if (!current) park(); },
    /** @param {string} id  @param {number} [atMs] start time on the layer's clock */
    play(id, atMs, { queue: shouldQueue = false } = {}) {
      const def = HAND_GESTURES[id];
      if (!def) throw new Error(`unknown hand gesture: ${id}`);
      if (current && shouldQueue) {
        if (current.def.id !== id && !queue.some((item) => item.id === id)) queue.push({ id, def });
        return def;
      }
      show(def);
      current = { def, start: atMs !== undefined ? atMs : lastT };
      return def;
    },
    update(tMs) {
      lastT = tMs;
      if (!current) return;
      const local = tMs - current.start;
      if (local < 0) return;
      const def = current.def;
      if (local >= def.dur) {
        const done = def;
        const next = queue.shift();
        if (next) {
          show(next.def);
          current = { def: next.def, start: tMs };
        } else {
          current = null;
        }
        return done;
      }
    },
    stop() { current = null; queue.length = 0; park(); },
    destroy() { if (g.parentNode) g.parentNode.removeChild(g); },
  };
}

/**
 * Rules 1 and 4, asserted rather than eyeballed — both were violated by an
 * early cut and neither is visible in a still of the resting pose. Run by
 * `authoring/tools/sweep.mjs` against every registered avatar, because the frame numbers
 * are derived per avatar and a rig with a different window could break the
 * budget without anything else noticing.
 *
 *   rule 1  the wrist never rises into the frame;
 *   rule 4  no gesture pushes ink through the portrait window's side edge, at
 *           any point in its rotation. A hand 440 units tall throws its outer
 *           corner ~110 units sideways at 14 degrees, so the budget has to be
 *           spent against `out` AND `rot` together.
 *
 * @param {{viewBox:{x:number,y:number,w:number,h:number}}} meta
 */
export function checkHandFraming(meta) {
  const fr = frameOf(meta.viewBox);
  const bad = [];
  const worst = {};
  for (const [name, def] of Object.entries(HAND_GESTURES)) {
    for (const [ms, dy] of def.dy) {
      if (dy < WRIST_DROP) bad.push(`${name}@${ms}ms wrist only ${dy} below the edge`);
    }

    // Walk the timeline rather than pairing extremes: `out` peaks during the
    // hold and `rot` peaks during the swings, and a check that multiplies the
    // two worst numbers together condemns gestures that are actually fine.
    // Points are only counted while they are ON SCREEN — the tails spend the
    // whole gesture below the frame edge and may reach anywhere they like.
    const sc = (def.sc || 1) * fr.reach;
    const pts = shapePoints(def.shape).map(([x, y]) => [x * sc, y * sc]);
    let reach = 0;
    let at = 0;
    for (let ms = 0; ms <= def.dur; ms += 20) {
      const out = sample(def.out, ms);
      const dy = sample(def.dy, ms);
      const a = (sample(def.rot, ms) * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (const [x, y] of pts) {
        // rotate (SVG clockwise), then the mirror in `place` flips x.
        const sx = -(x * c - y * s);
        const sy = x * s + y * c;
        if (dy + sy > 0) continue;          // below the frame's bottom edge
        if (out + sx > reach) { reach = out + sx; at = ms; }
      }
    }
    worst[name] = Math.round(reach + INK_HALF);
    if (reach + INK_HALF > fr.outboardLimit) {
      bad.push(`${name} puts ink ${worst[name]} outboard at ${at}ms, limit ${Math.round(fr.outboardLimit)}`);
    }
  }
  if (bad.length) throw new Error(`hand framing: ${bad.join('; ')}`);
  return { ok: true, wristDrop: WRIST_DROP, outboardLimit: fr.outboardLimit, worst };
}
