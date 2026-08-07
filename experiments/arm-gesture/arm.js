/**
 * arm-gesture — a hand at the frame edge, drawn the way a webcam sees one.
 *
 * Third cut. The stakeholder's webcam observation gave the second cut its rules
 * (only fingers/fist/palm ever in frame, motion from bottom centre, the wrist
 * never visible). Those rules survive unchanged. What the second cut got wrong
 * was the DRAWING, and an independent visual-artist review of all 40 rendered
 * frames said so in detail. The three findings that reshaped this file:
 *
 *   - The thumbs-up read as a raised middle finger. Four causes, all geometric:
 *     the digit rose from the TOP of the fist instead of its flank, it had a
 *     finger's proportions (long and slim) instead of a thumb's (short and fat),
 *     it had parallel sides and no joint, and it pointed straight up.
 *   - Palm and back-of-hand were the same drawing. A wave shows the palm; a
 *     thumbs-up necessarily shows the back. Nothing said which.
 *   - The open hand was a comb: five near-equal digits with valleys cut 80% of
 *     the way down and gaps narrower than the ink beside them, which fuse into a
 *     black smear at the 130 px acceptance size.
 *
 * WHAT IT TOOK TO FIX THE THUMB, because two obvious repairs both failed first.
 * Shortening the thumb was not enough: the fist it sits on was drawn at FACE
 * DEPTH, so only its top third cleared the frame, and a correct thumb still
 * looked as long as the visible mass it grew from. Widening the thumb was not
 * enough either, for the same reason. The hand had to get BIGGER — see `REACH`
 * — before a stubby thumb could look stubby. The finished proportion is the one
 * the emoji uses: the part of the thumb that clears the knuckles is WIDER THAN
 * IT IS TALL, and it sits at a corner of the mass rather than on top of it. The
 * long-thin/short-fat contrast is now what separates ONE_MOMENT from THUMBS_UP
 * at 130 px, which is the only place that distinction has to survive.
 *
 * THE THUMBS-UP TOPS OUT AT THE JAW, not the nose, and that is deliberate. A
 * fist-with-thumb-up reaches ~0.76 of a hand's length from the wrist; pin the
 * wrist below the frame edge as rule 1 requires and nose height is unreachable
 * without drawing the thumb longer than a middle finger — which is exactly what
 * the second cut did and exactly why it read the way it did. The stakeholder's
 * own report ("it just came up vertically and stopped around my nose") came from
 * a webcam framing more than a head and shoulders, so their wrist had room this
 * portrait window does not.
 *
 * The rules, unchanged from the second cut:
 *
 * 1. THE WRIST NEVER ENTERS THE FRAME (`WRIST_FLOOR`). Every gesture is posed by
 *    wrist position, and the wrist is pinned at or below the viewBox bottom at
 *    all times, so the hand is always CUT by the frame edge and never ends in a
 *    stump hanging in mid-air. Each shape is drawn with a long tail below the
 *    wrist that is clipped away; the ink outline is an OPEN mark that runs off
 *    the bottom rather than a closed ring, so there is no line across the bottom
 *    to give the crop away.
 *
 * 2. THE HAND IS BIG, because it is nearer the lens than the face and because
 *    once only fingers clear the edge, the fingers carry the whole read. How big
 *    is a depth question, not a style one, and gestures differ: a thumbs-up is
 *    pushed toward the lens, a wave is thrown out to the side and further away.
 *    `REACH` sets the near case and each gesture's `sc` steps back from it.
 *
 * 3. WHAT RISES PAST THE MOUTH IS ONLY EVER A DIGIT. Mouth sync is the headline
 *    feature (brief, constraint 2). The high gestures drift outboard as they
 *    rise, so at mouth height the only thing in front of the face is one finger.
 *    At true webcam scale an open palm is 65% of the frame's width, which cannot
 *    be got out of the way by moving it sideways — rule 4 forbids that much
 *    travel. So the waves sit LOWER and further back instead (`sc`), and the
 *    face stays entirely clear. This is what the review's "the hand must never
 *    become the subject" note costs in practice.
 *
 * And one new rule the review added, which is really rule 1's sibling:
 *
 * 4. THE ONLY EDGE THAT CUTS THE HAND IS THE BOTTOM ONE. peep's viewBox is a
 *    portrait window pillarboxed inside a 16:9 tile, so anything past x=668 is
 *    sliced by a hard vertical line that reads as a rendering fault. Every
 *    gesture's outboard travel is budgeted against the hand's own width AND its
 *    rotation — a hand 440 units tall swings ~110 units sideways at 14 degrees,
 *    which is what silently blew the budget last time. See `OUTBOARD_LIMIT`.
 *
 * Still an overlay appended into the mounted rig's own SVG: same coordinate
 * space, same theme keys, zero changes to src/, and no parameter channel (a
 * channel only one avatar can render is the documented mistake to avoid).
 */

import { taper, taperRing, region } from '../../src/line-art.js';
import { f } from '../../src/face-core.js';

// --- the frame --------------------------------------------------------------
// peep's viewBox is x 92..668, y 76..876 — the tile shows all of it (fitted by
// height, pillarboxed), so the viewBox bottom IS the visible bottom edge.
const CX = 380;             // frame centre; also where a resting hand starts
const FRAME_BOTTOM = 876;
const FRAME_RIGHT = 668;
// The wrist sits below the edge by a clear margin, never at it: a wrist exactly
// on the line renders as a rounded end kissing the border, which reads as a hand
// stuck to the frame rather than one coming from off-camera.
const WRIST_FLOOR = 900;
// Fully off-camera. Must clear the tallest shape.
const HIDE_Y = 1450;
// How far the outermost ink may sit from the wrist before the portrait window
// slices it (rule 4). Checked against every gesture by `checkFraming()`.
const OUTBOARD_LIMIT = FRAME_RIGHT - 8 - CX;   // 280 art units

// --- geometry ---------------------------------------------------------------
// Author units: wrist at (0,0), fingers up (-y), thumb toward -x. Points below
// are ON-CURVE and get run through `smooth()`; the +300 tails are the part the
// frame eats. One hand is drawn and mirrored for the other side (see `dir`).
//
// Two hand FAMILIES, and no gesture blurs them. This is the palmar/dorsal
// system the review asked for, built from only the cues that survive 130 px:
//
//            palmar (palm to camera)        dorsal (back to camera)
//   webs     smooth, shallow U              bumpy knuckle row
//   base     wide soft-cornered heel        straighter, narrower
//   thumb    out and clear of the fingers   crossing IN FRONT of the fist
//   interior one palm crease                no crease; a nail plate instead
//
// Cut on the review's advice because none of them survive the acceptance size:
// finger creases, tendon lines, knuckle bulges on extended fingers.

// --- palmar: the open hand, for waving --------------------------------------
// Three finger masses, not four: the ring and little fingers are one shape.
// That is standard caricature economy and it costs nothing in read — measured on
// the second cut, two of the finger gaps shrank to under a pixel at 130 px and
// fused, which is what turned the wave into a smear. Every white gap here is at
// least as wide as the ink beside it at the acceptance size.
const PALM = [
  // Ulnar edge. The tail NARROWS toward the frame cut — the fourth cut's single
  // cheapest fix. Every earlier hand widened as it approached the bottom edge,
  // which reads as a shape RESTING ON the edge (a bag, a sheet of paper) rather
  // than one continuing past it. Widest at ~a third down from the fingertips,
  // ~65% of that at the cut, and the eye infers the arm for free.
  [26, 300], [28, 60], [31, 16],
  [36, -20], [41, -54],                                  // the widest band
  [40, -86], [38, -112],                                 // ring+little, splayed
  [35, -138], [27, -150], [18, -147],                    // DOMED tip, never pointed
  [13, -134],            // notch floor: ~15% of finger length, and a U not a V
  [8, -146], [1, -164], [-8, -166],                      // middle, the longest
  [-16, -156],
  [-20, -136],           // notch floor
  [-25, -148], [-33, -157], [-40, -150],                 // index, domed
  [-44, -130], [-46, -110],
  [-47, -92],            // the thumb web — shallow, so this is a hand not a fork
  // The thumb is now a CONVEX WEDGE and that is a deletion, not an addition. The
  // third cut's thumb had a re-entrant curl in its outer contour; at 130 px the
  // hook read as a detached ear sitting beside the jaw, which was the single most
  // confusing mark in the set. There is no concavity anywhere in this contour: it
  // leaves the palm's outer edge, swells to a rounded pad at ~40 degrees off the
  // palm axis, and comes back. A thumb is a wedge, and a wedge has two edges.
  [-56, -99], [-65, -96], [-71, -87],
  [-72, -75], [-65, -67],                                // the pad: broad, round
  [-56, -58], [-49, -46],
  [-46, -26], [-42, 4],                                  // thenar, then the taper
  [-36, 60], [-32, 300],
];
// Where the finger information moved to. The third cut cut the interdigital
// valleys 50-60% of the way down the fingers, which makes a SAW: at 130 px a
// deep-notched silhouette reads as a crown or a claw, never as a hand. Real
// fingers are not separated at the silhouette, they are separated by short
// creases in the flesh. So the notches came up to ~15% and these three marks
// took over the job — thick at the notch floor, tapered to nothing over about a
// third of the finger's length, in exactly the mark language of peep's own ear
// whorl and nose hook. Three marks is the right budget for a hand living in a
// face made of about twelve.
const PALM_SEPS = [
  [[13, -130], [14, -122], [15, -113]],      // little/ring from middle
  [[-20, -132], [-21, -124], [-21, -115]],   // middle from index
  [[27, -141], [28, -134], [29, -127]],      // the ring/little split, implied
];
// The one interior mark that says PALM rather than back-of-hand. Kept short and
// tapered to nothing at both ends; a constant-width version of this read as a
// fold in fabric.
const PALM_CREASE = [[-40, -54], [-20, -42], [0, -39], [18, -44]];

// --- dorsal: the fist, for thumbs-up ----------------------------------------
// The back of a closed hand: an undulating top edge of metacarpal heads, and a
// base that is straighter and narrower than the palmar heel. No palm crease —
// a crease here would say palm.
// The knuckle row sits higher than anatomy alone would put it, and deliberately.
// Rule 1 keeps the wrist below the frame, so only the TOP of the fist is ever on
// screen — and the thumb's proportion is read against the VISIBLE mass, not
// against the whole hand. At an anatomically honest knuckle height two thirds of
// the fist was off-camera, which left a correct thumb looking as long as
// everything it was attached to. Raising the row to 0.56 of hand length puts the
// ratio back where the eye expects it: the thumb clears the knuckles by about
// half of what shows below them.
// The visible fist must also be WIDER THAN TALL, and the fifth cut is what
// taught us that. Drawn 75 wide against 90 tall above the frame cut it was not a
// fist, it was a tower — and a crest that ramped monotonically to a single spike
// at the index knuckle was its steeple. The crest is now a gentle arc, still
// highest toward the index side because that is true, but by 16 units across 60
// rather than by 30; the mass is 82 wide against 78 visible. The two undulations
// survive only as inflections in that arc.
const FIST = [
  [24, 300], [26, 60], [30, 12],            // the wrist really is ~60% of a fist
  [36, -22], [40, -46],                     // the heel, and the widest band
  [39, -66], [30, -74], [22, -70],          // TWO undulations, not four knuckles
  [12, -80], [-2, -86], [-14, -82],         // the larger one, index side
  [-26, -76], [-36, -64],
  [-42, -42], [-41, -16],
  [-37, 60], [-34, 300],
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
const FIST_CURL = [[28, -46], [10, -38], [-8, -42], [-26, -52]];
// The thumb is a SEPARATE CLOSED SHAPE crossing the fist, which is what keeps
// the middle-finger read dead. The third cut killed that read by making the
// thumb a stub — and overshot: a digit as tall as it is wide is not a thumb, it
// is a BUMP on a column, which is what the fourth review called it. A glyph has
// tolerances and these are them:
//   - within 8 degrees of VERTICAL. The third cut leaned it 17 degrees outboard
//     to get away from the middle finger's axis; the notches do that job now,
//     and a leaning thumb reads as a corner of the mass rather than a raised
//     digit;
//   - the part clearing the crest is 32 wide by 42 tall — about square, which is
//     the emoji's proportion and the whole reason this does not read as
//     ONE_MOMENT at 130 px. Longer and thinner is a finger; much stubbier and it
//     disappears into the silhouette;
//   - width ~1.4x a finger's;
//   - THE BASE IS INSIDE THE MASS, NOT BESIDE IT. This is the load-bearing one,
//     and the fifth cut is what proved it: two attempts put the thumb on the
//     flank — once as a long lozenge that detached into a second object, once as
//     an egg tangent to the knuckles that read as a raised finger — and the
//     diagnosis both times was the same. A thumb whose base sits outside the
//     fist's silhouette is not a thumb, it is a NEIGHBOUR. Its base is now buried
//     across 32 units of the crest;
//   - a NOTCH ON BOTH SIDES, and both SHALLOW. The notch floor is what makes a
//     thumb a thumb instead of a corner — the third cut's version merged into the
//     knuckle row on its inner side with no break at all — but a deep notch is
//     what re-detaches it. Both contours cross the crest within a few units of it.
// It is drawn UNDER the fist (see `build`), so the fist's fill swallows its base
// and one form visibly crosses another — the strongest depth cue available here
// and the only one that still works at 130 px.
const FIST_THUMB = [
  [10, -48],                                   // base, deep inside the fist's mass
  [2, -78], [-1, -100],                        // inner edge — SHORT, and that is the point
  [-6, -118], [-18, -128], [-31, -122],        // domed tip, and a wide dome
  [-38, -106], [-38, -88],
  [-36, -70], [-32, -56], [-25, -44],          // outer edge, tucking back under the crest
  [10, -48],
];
// FIST_NAIL is deleted, and it is the clearest single deletion in this cut. A
// short curved crease near the top of the thumb, at 130 px, on a rounded white
// form beside a face: it read as a CLOSED EYE. The tile had two faces in it.

// --- dorsal: index up, for "one moment" -------------------------------------
// The same fist back, with the index extended. It is the fist's silhouette that
// separates this from THUMBS_UP at a glance: a long straight digit rising a full
// fist-height above the knuckles, against a short fat one clearing them by half.
// This is the gesture the fourth review passed outright, so it changes least —
// it is the reference the other three were rebuilt toward, and the reasons it
// works are the whole lesson: it stands against the BACKGROUND rather than
// against the shirt, its meaning lives in one unambiguous silhouette rather than
// in notches, and where it crosses the hair, value does the separating.
const POINT = [
  [22, 300], [24, 60], [27, 14],
  [31, -24], [33, -50],
  [30, -76], [21, -84], [12, -78],           // two undulations, as on FIST
  [1, -88], [-13, -98], [-22, -94],
  // The index. It was a post: near-constant width, no joint. A bulge at the
  // proximal phalanx and a pinch of ~8% at the middle joint (~45% up) is all it
  // takes to say FINGER instead of bollard, and it is done in the outline rather
  // than with an added crease — a crease that small does not survive 130 px.
  [-19, -106], [-20, -122], [-21.5, -131],   // inner edge: the pinch
  [-22, -146], [-23, -160],
  [-28, -171], [-36, -173],
  [-42, -166], [-42.5, -154],                // outer edge
  [-41, -131], [-43, -116],                  // the matching bulge below it
  [-41.5, -100],
  // The thumb, clamped across the curled fingers and showing as a lobe on the
  // flank. An index-up fist with no thumb anywhere in it is quietly impossible.
  [-44, -84], [-48, -70], [-45, -56],
  [-43, -40], [-41, -16],
  [-36, 60], [-33, 300],
];

// Author scale, and the number this cut changed most. Earlier cuts drew the hand
// at face depth: a 19 cm hand against a 23 cm head is 0.83 of it, peep's head is
// 477 art units, so 394 — and that is what came out looking like a pale tube
// rising past the collar. It is the wrong depth. A hand raised to a webcam sits
// roughly 40 cm from the lens with the face at 60, so it images about 1.5x
// larger: ~590 units wrist-to-fingertip. The open hand is 170 author units, so
// 3.4 is the honest scale and 2.6 was a drawing of a hand held at the chest.
// Everything downstream follows from this — the fist finally has enough mass to
// read AS a fist rather than as the gap between two lines, and the thumb clears
// the jaw. Rule 4 is what caps it: see the trimmed `out` peaks below.
//
// The fourth cut walked it back to 2.95, and the argument that pulled it back is
// not the optical one. 3.4 put the palm at ~1.05 head-widths, which is honest —
// a hand near a webcam really does image larger than the face behind it. But at
// 130 px the viewer gets ONE GLANCE, and the largest brightest mass in the tile
// becomes its subject. When that mass is an information-free white slab the
// composition inverts: the hand becomes the figure and the head becomes ground,
// and the tile reads as broken before it reads as a gesture. Optically correct,
// perceptually wrong. 2.95 puts the palm at ~0.82 head-widths, which is the top
// of the band where the hand is still clearly nearer the lens and still clearly
// not the subject. Note what did NOT come back with the old number: the knuckle
// row stays high, because that fix was about the VISIBLE mass, not the scale.
const REACH = 2.95;

// Ink weights are in ART units, sampled off peep's own marks: the torso runs
// 8-11, the head peaks at 17 but its face contour sits at 10-12. The second cut
// ran a near-constant 14 all the way round, which made the hand both the
// heaviest and the only untapered mark in the picture — the review's diagnosis
// for why it read as a sticker composited over a drawing.
//
// So the profile now carries a light direction, upper-left as the face already
// implies: thin across the fingertips (s in the middle of the mark), thick down
// the two tails where the hand is nearest the camera and furthest from the
// light. Widths are not scaled with REACH — perspective makes the hand bigger,
// not the pen wider.
//
// The fourth cut made the whole profile HEAVIER, and this is the fix for a hand
// that would not sit in front of the shirt. The nearest object in the frame was
// carrying the lightest line in the frame: peep's jaw contour runs 10-12 and the
// third cut's hand peaked at 13, so the drawing said "behind" while the geometry
// said "in front", and the eye believes the drawing. This is device 2 of the
// three a two-colour inker has for a white form crossing a white form (compose
// so it doesn't cross; weight hierarchy; knockout) and it is the one already
// native to peep, whose head contour outweighs its brow which outweighs its ear
// whorl. The hand now runs ~1.3x the jaw along the underside and inner edges and
// ~0.5x at the crown of the fingertips.
const W_OUTLINE = [16, 15, 9, 6, 9, 15, 17];
// Device 3, the knockout: a white halo that breaks the shirt's seams where the
// hand crosses them. It is deliberately NARROW across the middle of the mark:
// the hand's upper half sits against the background, and a white rim there would
// turn it into a cut-out sticker. Only the tails — the part over the shirt — get
// the full gap. Where the halo width equals the ink width it is entirely covered
// and costs nothing, so the profile is scaled with the ink above it.
const W_HALO = [34, 29, 13, 6, 13, 29, 35];
const W_CREASE = [2, 8, 2];
// The palm's finger separators: thick where they leave the notch floor, gone by
// the end. This is the ear-whorl mark language, applied to a hand.
const W_SEP = [7, 3, 0.5];
// The fist's one interior mark. Thick-to-thin across an S, so it reads as a form
// turning rather than as a drawn line.
const W_CURL = [3, 9, 7, 2];
const W_THUMB = [12, 14, 11, 8, 11, 14, 12];

/**
 * On-curve points -> polybezier (the form `taper`/`region` want). Catmull-Rom
 * with the standard 1/6 tension, so the geometry above stays readable as a
 * drawing instead of as three-in-four control points. Hand-authored control
 * points are the house idiom in src/; this is an experiment, and legible
 * geometry is worth more here than the last 5% of curve control.
 */
function smooth(pts) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    out.push(
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2
    );
  }
  return out;
}
const scaled = (pts) => smooth(pts.map(([x, y]) => [x * REACH, y * REACH]));

// The shapes, and the widest bit of ink each one puts outboard of the wrist —
// in art units, before rotation. `checkFraming()` spends this against rule 4.
// Interior marks now carry their own width profile rather than sharing one:
// three of them exist and they do three different jobs, and a separator drawn at
// crease weight is a crease.
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
    marks: [{ pts: [[20, -54], [4, -48], [-12, -54]], w: W_CURL }],
    rings: [],
  },
};
const shapePoints = (name) => {
  const s = SHAPES[name];
  return [s.outline, ...s.marks.map((m) => m.pts), ...s.rings.map((r) => r.pts)]
    .flat().map(([x, y]) => [x * REACH, y * REACH]);
};
// Half the heaviest mark, so the check measures ink rather than centreline.
const INK_HALF = 9;

// --- timelines --------------------------------------------------------------
// Channels: out (outward offset from frame centre, art units — the sign is
// applied by `dir`), y (wrist, art units, larger is further off-camera), rot
// (degrees about the wrist). Keys are [ms, value] with smoothstep between.
// Timings are baked so every gesture reads with no audio at all (constraint 5).
//
// Every gesture starts at out=0: the hand comes up from the middle, from wherever
// it was resting, and finds its position on the way. Nothing teleports to the
// side and then rises, which is what an arc-less rig looks like.
//
// Three animation habits the review found missing and every timeline now has:
//   - the rise OVERSHOOTS its hold by ~8% and settles back over ~110 ms. A hand
//     that stops dead on the frame it arrives reads as a sprite being placed;
//   - the hold BREATHES. The second cut's holds were pixel-identical for four
//     and five frames running, which reads as a frozen render, not as stillness;
//   - the exit leaves on a different path from the entry — straighter down and
//     angled toward the body, because that is what dropping a hand looks like.
//
// AND THE FOURTH CUT RE-TIMED ALL OF THEM, on the note "it is a bit slower and
// it lingers a bit longer than I'd think". Three separable faults, because a
// gesture is a rise, a hold and an exit and they were each wrong differently:
//
//   THE RISE eased in AND out, over 420-470 ms, which is a lift, not a throw.
//   A hand entering frame is ballistic: it leaves fast and brakes late. The
//   first key now sits at ~55% of the travel in ~150 ms, so most of the
//   distance is gone before the eye catches up, and the last 45% is the brake.
//   This is the same argument as gaze.js's ballistic head-follow — the STOP is
//   what says the movement arrived somewhere on purpose.
//
//   THE HOLD was ~1 s on all four, which is why they lingered. The hold only
//   has to be long enough to be read, and a gesture the viewer has already
//   read is a gesture standing in front of the face for no reason. Waves hold
//   only as long as the swings take; THUMBS_UP holds 750 ms; ONE_MOMENT keeps
//   the longest hold of the four because buying time IS its job.
//
//   THE EXIT decelerated into the frame edge, so the hand sank rather than
//   dropped. A released hand accelerates away, so the exit now covers <20% of
//   its travel in its first third. It is also the shortest of the three
//   phases: you take longer to raise a hand than to let it fall.
//
// Wave rate went 2.4 Hz -> 3.0 Hz (HI) and 2.0 -> 2.8 (BYE). 2-3 Hz is the
// social wave band; the bottom of it reads as tired, and the swing is the only
// part of a wave that carries the word "hi". BYE stays the slower and wider of
// the two, and buys its extra weight with a FOURTH swing rather than with a
// longer hold — which is the difference between a farewell and a stall.
//
// Totals: HI 1700 -> 1250, BYE 2100 -> 1550, THUMBS_UP 1800 -> 1300,
// ONE_MOMENT 2200 -> 1700.
//
// `face` names the interjection clip that plays with the hand. It is not
// decoration: a hand rising to the jaw while the shoulders and head sit
// perfectly still is not attached to anybody. Those clips already exist in
// src/interjections.js and already move head, brows, shoulders and torso — the
// hand is the missing half of a gesture the rig has always half-played.
//
// `sc` is the gesture's DEPTH, multiplying REACH about the wrist. One number,
// and it is the difference between a wave and a hand held up to the lens: you
// push a thumbs-up toward the camera and you throw a wave out to the side, so
// the waves render at 0.72 and everything else at 1. Without it the palm — the
// widest shape in the set — covered the whole face at every height it could
// legally occupy, which is a mouth-sync regression, i.e. a hard no.
export const GESTURES = {
  // Wave. Out and up along an arc, three swings, gone. The peak puts the
  // fingertips around y=600 — a third of the frame height above the bottom edge,
  // which is where the stakeholder's own wave sat — so the hand passes the neck
  // and shoulder, never the face. ~2.4 Hz, the relaxed social rate; faster reads
  // as flagging someone down.
  //
  // The swing is deliberately ASYMMETRIC, -2 out and +16 in. A wave rotating
  // about a wrist below the frame throws the fingertips ~110 units sideways, and
  // spending that outboard is what put the thumb through the portrait window in
  // the second cut. Swinging further toward the person you are waving at is
  // also, conveniently, what people do.
  HI: {
    shape: 'PALM', face: 'WAVE', dur: 1250, sc: 0.70,
    out: [[0, 0], [150, 74], [300, 114], [1000, 114], [1250, 30]],
    y: [[0, HIDE_Y], [150, 1116], [300, 916], [390, 936], [700, 926], [1000, 934], [1120, 1012], [1250, HIDE_Y]],
    rot: [[0, -3], [150, 2], [310, 16], [475, -2], [640, 16], [805, -1], [970, 12], [1000, 8], [1250, -3]],
  },
  // Goodbye: same hand, slower, one more swing, and it lingers at the top before
  // dropping. A wave that leaves as briskly as it arrived reads as a dismissal
  // rather than a farewell.
  BYE: {
    shape: 'PALM', face: 'WAVE', dur: 1550, sc: 0.70,
    out: [[0, 0], [170, 76], [320, 116], [1300, 116], [1550, 32]],
    y: [[0, HIDE_Y], [160, 1106], [320, 908], [410, 930], [700, 918], [1000, 928], [1300, 922], [1420, 1004], [1550, HIDE_Y]],
    rot: [[0, -3], [170, 2], [330, 16], [510, -2], [690, 16], [870, -2], [1050, 16], [1230, -1], [1300, 8], [1550, -3]],
  },
  // Thumbs-up: straight up the middle, drifting outboard, and it stops at the
  // JAW. See the header — the nose is not reachable by a thumb of honest length
  // from a wrist below the frame, and reaching for it anyway is what produced
  // the gesture the stakeholder rejected. The wrist spends the entire budget
  // (it sits on WRIST_FLOOR), so the fist rides the bottom edge and only the
  // thumb is up near the face.
  THUMBS_UP: {
    shape: 'FIST', face: 'THUMBS_UP', dur: 1300,
    out: [[0, 0], [160, 54], [300, 84], [1050, 84], [1300, 32]],
    y: [[0, HIDE_Y], [160, 1050], [300, 900], [390, 918], [700, 910], [1050, 916], [1160, 996], [1300, HIDE_Y]],
    rot: [[0, -6], [160, -2], [300, 3], [400, 0], [700, 1.5], [1000, 0], [1050, 0], [1300, -8]],
  },
  // One moment: index up, and then almost still. The hold is the signal — any
  // real sway during it turns a "wait" into a wave, so the drift here is a
  // couple of units and a degree, which reads as a held hand rather than as a
  // stopped clock. Held longest of the four, because it is the one gesture whose
  // job is to buy time (research-perception.md section 1, latency masking).
  ONE_MOMENT: {
    shape: 'POINT', face: 'ONE_MOMENT', dur: 1700,
    out: [[0, 0], [170, 60], [320, 96], [1400, 96], [1700, 34]],
    y: [[0, HIDE_Y], [170, 1120], [320, 908], [410, 930], [700, 922], [1100, 929], [1400, 924], [1520, 1012], [1700, HIDE_Y]],
    rot: [[0, -7], [170, -2], [320, 2], [420, 0], [800, 1], [1200, -0.5], [1400, 0], [1700, -9]],
  },
};

// GO_ON is deliberately absent, and this is the reasoning rather than an
// oversight. The second cut drew it as a low splayed open palm rocking at the
// wrist; the stakeholder's verdict was "go on doesn't work for me" and the
// review was blunter — a black comb with no baseline. Three reasons it cannot be
// tuned into shape here:
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
// does not justify. The face already carries it well — GO_ON survives as a
// face-only interjection clip and is untouched by this experiment.

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

// --- the overlay ------------------------------------------------------------

/**
 * @param {{svg: SVGElement, theme: object, interject?: Function}} api  a mounted
 *   avatar. `interject` is used to play the gesture's face half; pass
 *   `{face:false}` to suppress it and see the hand alone.
 * @param {{dir?: number, face?: boolean}} [opts]  dir +1 puts the hand on the
 *   viewer's right (the avatar gesturing with its left hand), -1 on the viewer's
 *   left. Both are anatomically real — the thumb always splays outward, away
 *   from the body — so this is a choice of which hand the character uses, not a
 *   mirroring bug. +1 is what the stakeholder saw in their own webcam, whose
 *   self-view is mirrored.
 * @returns {{play(name:string, atMs?:number):void, update(tMs:number):void,
 *            stop():void, setDir(d:number):void, playing:boolean}}
 */
export function createArm(api, opts = {}) {
  const t = api.theme;
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  api.svg.appendChild(g);

  let dir = opts.dir === -1 ? -1 : 1;
  const withFace = opts.face !== false && typeof api.interject === 'function';

  const ink = (d) => `<path d="${d}" fill="${t.ink}"/>`;
  const pap = (d) => `<path d="${d}" fill="${t.paper}"/>`;

  // Paint order per shape, and each layer earns its place:
  //   halo   white, wider than the ink, and only at the tails — it breaks the
  //          shirt's seams where the hand crosses them so the two whites do not
  //          run together (the second cut's hand dissolved into the shirt).
  //   fill   the closed contour, tail and all.
  //   ink    the SAME contour as an open mark, so it runs off the bottom edge
  //          instead of drawing a lid across the wrist.
  // The rings (the thumb) go UNDER all of it, and that order is the whole trick.
  // Painted on top, the thumb's closed shape ran unbroken from the frame edge to
  // its tip and the entire radial column read as ONE very long digit — the
  // middle-finger silhouette, rebuilt out of correct parts. Painted underneath,
  // the fist's fill swallows the thumb's base and its halo opens a white gap at
  // the crossing, so the thumb emerges from the flank exactly as far as it
  // should: about half the fist's height, and no further.
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

  let current = null; // { name, def, start }
  let lastT = 0;

  function place(x, y, rot, sc) {
    // scale(-dir) mirrors the drawing so the thumb always points AWAY from the
    // body, whichever side the hand is on; `sc` is the gesture's depth (see
    // GESTURES.sc), and scaling about the wrist origin leaves the wrist where
    // the timeline put it.
    g.setAttribute('transform',
      `translate(${f(x)} ${f(y)}) scale(${f(-dir * sc)} ${f(sc)}) rotate(${f(rot)})`);
  }
  function park() {
    for (const s of Object.values(shapes)) s.style.display = 'none';
    place(CX, HIDE_Y, 0, 1);
  }
  park();

  return {
    get playing() { return !!current; },
    setDir(d) { dir = d === -1 ? -1 : 1; if (!current) park(); },
    play(name, atMs) {
      const def = GESTURES[name];
      if (!def) throw new Error(`unknown gesture ${name}`);
      for (const [k, s] of Object.entries(shapes)) {
        s.style.display = k === def.shape ? '' : 'none';
      }
      if (withFace && def.face) api.interject(def.face);
      current = { name, def, start: atMs !== undefined ? atMs : lastT };
    },
    update(tMs) {
      lastT = tMs;
      if (!current) return;
      const local = tMs - current.start;
      if (local < 0) return;
      if (local >= current.def.dur) { current = null; park(); return; }
      const d = current.def;
      place(CX + dir * sample(d.out, local), sample(d.y, local), sample(d.rot, local), d.sc || 1);
    },
    stop() { current = null; park(); },
  };
}

/**
 * The two framing rules, asserted rather than eyeballed — both were violated by
 * the second cut and neither is visible in a still of the resting pose.
 *
 *   rule 1  the wrist never rises into the frame;
 *   rule 4  no gesture pushes ink through the portrait window's side edge, at
 *           any point in its rotation. A hand 440 units tall throws its outer
 *           corner ~110 units sideways at 14 degrees, so the budget has to be
 *           spent against `out` AND `rot` together.
 */
export function checkFraming() {
  const bad = [];
  const worst = {};
  for (const [name, def] of Object.entries(GESTURES)) {
    for (const [ms, y] of def.y) if (y < WRIST_FLOOR) bad.push(`${name}@${ms}ms wrist y=${y}`);

    // Walk the timeline rather than pairing extremes: `out` peaks during the
    // hold and `rot` peaks during the swings, and a check that multiplies the
    // two worst numbers together condemns gestures that are actually fine.
    // Points are only counted while they are ON SCREEN — the tails spend the
    // whole gesture below the frame edge and may reach anywhere they like.
    const sc = def.sc || 1;
    const pts = shapePoints(def.shape).map(([x, y]) => [x * sc, y * sc]);
    let reach = 0;
    let at = 0;
    for (let ms = 0; ms <= def.dur; ms += 20) {
      const out = sample(def.out, ms);
      const wy = sample(def.y, ms);
      const a = (sample(def.rot, ms) * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (const [x, y] of pts) {
        // rotate (SVG clockwise), then the mirror in `place` flips x.
        const sx = -(x * c - y * s);
        const sy = x * s + y * c;
        if (wy + sy > FRAME_BOTTOM) continue;
        if (out + sx > reach) { reach = out + sx; at = ms; }
      }
    }
    worst[name] = Math.round(reach + INK_HALF);
    if (reach + INK_HALF > OUTBOARD_LIMIT) {
      bad.push(`${name} puts ink ${worst[name]} outboard at ${at}ms, limit ${OUTBOARD_LIMIT}`);
    }
  }
  if (bad.length) throw new Error(`framing: ${bad.join('; ')}`);
  return { ok: true, floor: WRIST_FLOOR, frameBottom: FRAME_BOTTOM, outboardLimit: OUTBOARD_LIMIT, worst };
}
