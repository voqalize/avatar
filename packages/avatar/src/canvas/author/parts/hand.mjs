// ---------------------------------------------------------------------------
// author/parts/hand.mjs — the SECONDARY GESTURE hand: one drawing, placed by
// four numbers, that rises from under the bottom edge of the frame, holds
// beside the face and drops back out.
//
// It is a PART in the sense ./README.md means, with one difference worth
// saying out loud: every other part in this directory is a piece of a FACE and
// is driven by the control vector's face channels. This one is not on the face
// at all. It is the nearest object in the frame, it lives in FRAME space, and
// the only thing that reaches it is a single `HandFrame`.
//
//   CONSTRUCTION (build time, once per persona)
//     makeHand({ P, PALETTE, solid, frame, pen, group })
//     `frame` is the four numbers below, `PALETTE` supplies the skin rungs, so
//     the hand is the same character's hand as the face above it.
//
//   DRIVING  part.draws(h, env) -> the thirteen draws (twenty-six with a
//            `pen`: every silhouette gains a line), in paint order
//   REST     handRest() -> the `hand:` block of the control vector; also
//            `part.rest`. At rest there is no gesture: every draw is at alpha
//            0 AND parked below the frame, which is two independent reasons
//            for a hand not to be on screen and exactly one more than a rig
//            with a wardrobe, a pose blend and a live evaluator deserves.
//
// ---------------------------------------------------------------------------
// THE DRIVER BLOCK. voqalize's `HandFrame`, verbatim, all three fields:
//
//   field      rest        meaning
//   gesture    null        'greet' | 'farewell' | 'approve' | 'wait', or null
//                          / anything unknown, which is "no hand"
//   progress   0           0..1 through that gesture. The MIXER owns the
//                          clock: it computes `(now - start) / dur` and we
//                          never see a millisecond. `GESTURES[g].dur` is here
//                          for documentation and for a host that wants to
//                          drive the sweep at the upstream tempo.
//   side       'right'     'right' puts the hand on the VIEWER's right (the
//                          character gesturing with its left hand), 'left' on
//                          the viewer's left. A persistent per-avatar setting
//                          upstream, not something a gesture chooses.
//
// Both ends of that are honest: the thumb splays AWAY from the body on either
// side, because the drawing is mirrored rather than translated.
//
// ---------------------------------------------------------------------------
// THE FOUR NUMBERS, and why they are the caller's and not ours.
//
//   cx              design x of the frame's centre
//   bottom          design y of the frame's BOTTOM EDGE — the visible one, the
//                   one `meta.artboard` + `meta.align` crop to, not the
//                   artboard's
//   reach           design units per ART unit: the hand's size
//   outboardLimit   how far from `cx` ink may travel before it leaves the
//                   frame through a SIDE edge
//
// A part cannot derive those. `bottom` is the camera window's, which is
// metadata an avatar owns (avatars/round/face.mjs, CAMERA), and a rig that is
// framed differently gets a different hand size for the same drawing. So the
// avatar hands them in, and this file's geometry is in ART units throughout —
// one multiply by `reach` on the way out.
//
// ---------------------------------------------------------------------------
// WHERE THE DRAWING COMES FROM. Not from upstream's point tables, and that is
// the second cut of this file rather than the first.
//
// The first cut copied voqalize's `hand.js` outlines verbatim, on the argument
// that the same character has to wave in both renderers. What that argument
// misses is that upstream draws every shape with a black ink contour, and a
// contour carries an enormous amount of read: three lumps and a stub are a
// hand once a line goes round them. Round has no outlines. The same three
// lumps, filled flat, are a mitten — which is exactly what came back from the
// first 1x judging, in those words.
//
// So the shapes here are MEASURED, the same way `parts/mouth` and `parts/eye`
// are measured: `parts/sheet.py --kind hand` renders one 1536x1024 reference
// sheet of three hands in a flat, front-lit, outline-free vocabulary, and
// `parts/ref/hand/v1-medium.png` is traced into silhouette profiles — column
// tops for the fingertips, row run-lengths for the finger boxes and the gaps,
// the narrowest row of the lower third for the wrist, the crease and shade
// components for the interior marks. Every number below is that trace, in ART
// units, at
//
//   1 art unit = 1 reference-sheet pixel / 6.667      (PX_TO_ART, below)
//
// with the origin at the WRIST CENTRE of that cell and y NEGATIVE UP.
//
// The trace also settled the finger proportions, and settled them the way a
// hand is actually read: not "each finger is 92% of the middle one's LENGTH",
// which depends on where you decide the knuckle is, but "each fingertip stands
// at 92% of the middle fingertip's HEIGHT ABOVE THE WRIST", which is what the
// silhouette shows. Measured: index .924, middle 1, ring .944, little .806.
//
// ---------------------------------------------------------------------------
// HOW BIG, and the one number in this file that is a compromise rather than a
// measurement.
//
// The size is set against peep's hand — the same gesture, in the same demo, at
// the same 1x toggle — because that is the hand a viewer has already seen, and
// because that toggle sizes the two frames so BOTH HEADS measure 229 px across
// (adapter/demo.html, ONE_X), which is the only thing that makes a pixel over
// there comparable with a pixel over here.
//
// Measured rather than guessed: peep's hand group rasterised on its own,
// alpha-boxed, sampled every 80 ms through greet. Through the hold it is
// 130-132 wide by 80-88 tall; at the top of the hold, 131 x 85 CSS px.
//
// Those two numbers cannot both be matched, and the reason is anatomy rather
// than tuning: peep's hand is a squat caricature, 1.54 wide for every 1 tall
// of what the frame lets you see. A hand with five fingers on it is 0.67 wide
// for every 1 tall — the trace says 430 x 644 — and no arrangement of five
// fingers says otherwise. Matching the WIDTH would make ours half as tall
// again as peep's whole hand; matching the HEIGHT would make ours two thirds
// as wide, and at 1x a finger would be eight pixels across, which is where the
// mitten came from.
//
// What is matched instead is the AREA of that bounding box — the ink on
// screen, which is what "the same size hand" means to an eye, and which is
// also the measure by which the first cut of this file was called 1.6x too
// big. Ours comes out 99 x 112 against peep's 131 x 85: the same ink to within
// half a percent, 24% narrower, 32% taller. That height is 1.18 of round's
// chin-to-eyes distance (95 px at 1x) and 0.50 of its head — a hand, not a
// head, which is the rule the size was asked to obey.
//
// ---------------------------------------------------------------------------
// THE FOUR RULES the drawing obeys, which are upstream's and which are the
// whole reason a hand with no arm reads as a hand with an arm:
//
//   1. THE WRIST NEVER ENTERS THE FRAME. Every silhouette runs to art y +300
//      and is cut by the bottom edge; the wrist line itself is always at least
//      ~24/576 of the frame width BELOW it. A lid drawn across the wrist is a
//      severed hand, and the eye reads a severed hand as a sticker.
//      The NARROWING is visible even though the narrowest point is not: each
//      `hold` below is solved so the crop falls 16-19 art units above the
//      wrist (hold / sc, the four of them 19.0 / 18.5 / 16.0 / 17.0), where the
//      heel has already lost a quarter of its width and the plane painted
//      across it has already turned it under. What continues below the crop is
//      the forearm.
//   2. THE HAND IS BIG, but measured against peep and not against the frame —
//      see the section above. A correctly-scaled hand reads as a prop.
//   3. WHAT RISES PAST THE FIST IS ONLY EVER A DIGIT, and nothing reaches the
//      chin. The stations came down when the drawing came down in size (a
//      smaller hand cannot hold its fingertips at the jaw AND keep its wrist
//      out of frame — the two constraints meet only at a hand this file no
//      longer draws), so the four holds land at .725 / .728 / .683 / .820 of
//      the way from the bottom edge to the chin, and the only marks that clear
//      the fist are the thumb of `approve` and the index of `wait`.
//   4. ONLY THE BOTTOM EDGE CUTS THE HAND. `outboardLimit` is checked against
//      the shape's own width AND its rotation — a hand this tall swinging 16
//      degrees about a wrist below the frame throws its corner a long way
//      sideways, and the swing counts against the budget. `checkFraming()`
//      below is that check, run by the avatar's build.
//
// ---------------------------------------------------------------------------
// WHAT WE DO NOT DO, all of it deliberate:
//
//   * no arm above the forearm stub, no shoulder — see rule 1. The arm is
//     implied by the crop; drawing it would put a limb on a character that has
//     none.
//   * no idle hand. The hand exists for the length of one gesture and is not
//     on screen otherwise. There is no resting-hand pose to blend to.
//   * no clock. `progress` crosses the seam; the mixer owns start, duration,
//     interrupt and queue, exactly as upstream does.
//   * no per-gesture side. `side` is the avatar's, set once.
//   * no fingernails, no knuckle wrinkles, no palm lines beyond one. The
//     reference sheet was asked for none of them either: at 94 px across, the
//     marks that survive are the ones separating MASSES, and the rest reads as
//     dirt on the lens.
//
// THE ROUND IDIOM. Flat skin planes off the persona's own palette — `face` for
// the lit mass (the hand is nearer the light than the neck behind it), an
// OPAQUE rung below it for the planes turning away (see `paints()` for why it
// may not be `PALETTE.shade`), `crease` for the interior marks. No outline:
// `pen` is the hook the ink idiom takes (see below), and it is off unless
// somebody asks for it. Which is why the SEPARATIONS here are tonal and not linear: a
// thumb tucked at the side of a fist in the same flat skin as the fist is part
// of the fist, so `point`'s folded thumb is drawn a rung darker — on the true
// side of the form as well, since a thumb crossing a fist IS a plane of it
// turning away. `approve`'s thumb is the exception and for the same reason
// read the other way: it stands UP, clear of the fist against the background,
// in the same light as everything else, and a darker one read as a bruise.
//
// THE INK IDIOM, which is `pen` and which is the same drawing with a line round
// it. Ink's own numbers, not this file's: `PALETTE.ink` (rgb 25,35,51) at
// W_SIL = 4.0 artboard units on every silhouette — the mass, the digits, the
// raised thumb, the folded one — and W_FINE = 2.4 on the interior marks, which
// are the same two weights avatars/ink/face.mjs gives the head's outline and
// its jaw accent. A stroke width is a constant of a draw (`rig.js` copies it
// from base to out and never blends it), so it does NOT shrink with the
// gesture's depth `sc`: a pen has one nib and a hand pushed at the camera is
// still drawn with it.
//
// What changes besides the outline, all of it because a line is not a tone:
//   * the interior marks are STROKED runs rather than filled tapered rings, so
//     an outlined palette is never asked for a `crease` rung (ink has none);
//   * the JOINT marks go, because the distal segment's own contour draws that
//     line already;
//   * the folded thumb of `point` moves from under the fist to on top of it, as
//     a line. Under it, it is invisible in both idioms — it clears the fist's
//     edge by under 1.5 art units — and round says "folded thumb" with the one
//     thing a flat style has, a darker rung. A pen says it with a contour.
//
// THE FIXED-OPCODE GUARANTEE. Every run in here has a length fixed at module
// load; the per-frame work is an affine over points and then `spline`. The
// three shapes have three different topologies, so all thirteen draws — 26
// under a pen — are emitted every frame and the gesture chooses which are at
// alpha 1. Nine of the thirteen (eighteen of the 26) are always at zero, which
// costs the renderer that many comparisons and buys a display list that never
// changes shape.
// ---------------------------------------------------------------------------

import { spline, openSpline, strip, contours, circle } from '../path.mjs';
import { clamp, drawPusher } from '../rig.mjs';

// --- the front door --------------------------------------------------------

// Design units of the frame per ART unit, at a 576-wide frame. Art units are
// the reference sheet's pixels over 6.667 (PX_TO_ART), so this number and that
// one together are the whole of "how big is the hand"; this is the half that
// stays put when the drawing is re-traced.
export const REACH_AT_576 = 2.31;

// Rule 4's margin, in the same 576-wide frame units.
export const SIDE_MARGIN = 8;

// Rule 1, in ART units: how far below the frame's bottom edge the parked hand
// sits. It has to clear the tallest shape at its own depth scale — `wait`'s
// index finger, 93.75 * 0.75 = 70.3 — with room for the exit's rotation.
export const HIDE = 80;

// The reference sheet is 1536 x 1024 for three cells, so a cell is 512 wide and
// the hand in it is 430 x 644 px. This is the only place those pixels become
// art units, and the divisor is chosen so the placed hand's bounding box
// matches peep's in AREA — see "HOW BIG" above. Nothing else knows the sheet
// exists; the tables below are already converted.
export const PX_TO_ART = 1 / 6.667;

// Mark widths are quoted in upstream's SVG units, where the drawing was tuned;
// this converts them to art units so they scale with `reach` like everything
// else. Halved against the first cut, because the drawing they decorate is
// half the width it was, and a crease that keeps its absolute weight while the
// form under it halves stops being a crease and becomes a scar.
const MARK_K = 1 / 4.80;

/**
 * The four placement numbers, from the avatar's own camera window.
 * @param {{x:number,y:number,w:number,h:number}} win  the VISIBLE rectangle in
 *   design space — what `meta.artboard` + `meta.align` crop to.
 */
export function handFrameOf(win) {
  const k = win.w / 576;
  return {
    cx: win.x + win.w / 2,
    bottom: win.y + win.h,
    reach: REACH_AT_576 * k,
    outboardLimit: win.w / 2 - SIDE_MARGIN * k,
  };
}

/** The `hand:` block of a control vector. */
export function handRest() {
  return { hand: { gesture: null, progress: 0, side: 'right' } };
}

// ---------------------------------------------------------------------------
// TWO GENERATORS, both run once at module load.
//
// They exist because a finger written out as twelve literal points is twelve
// numbers nobody can check against a measurement, and there are nine fingers
// and thumb segments in this file. Written as an axis and two widths, every one
// of them can be read straight off the trace — and the point COUNT is a
// constant, which is the whole of the fixed-opcode guarantee.
// ---------------------------------------------------------------------------

// A tapered digit with a rounded tip and a base meant to be buried in the mass
// it grows from. 12 points, always.
//
//   base/tip   the axis, in art units
//   wb/wt      width ACROSS the digit at the base and at the tip
//
// The cap is a half-circle of radius wt/2 about the tip, sampled at 0, 45 and
// 90 degrees each side, which is what makes a fingertip round rather than
// chamfered; the base runs 15% of the length PAST the base point so the join
// into the palm has no shoulder to catch the eye.
const digit = (base, tip, wb, wt) => {
  const dx = tip[0] - base[0], dy = tip[1] - base[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;          // along the digit, toward the tip
  const nx = -uy, ny = ux;                 // across it
  const at = (t, s) => [base[0] + ux * L * t + nx * s, base[1] + uy * L * t + ny * s];
  const w = (t) => (wb + (wt - wb) * t) / 2;
  const r = (wt / 2) / L;                  // the cap, as a fraction of the axis
  const W = w(1 - r), c = 0.7071;
  return [
    at(0, -w(0)), at(0.35, -w(0.35)), at(0.7, -w(0.7)), at(1 - r, -W),
    at(1 - r + r * c, -W * c), at(1, 0), at(1 - r + r * c, W * c), at(1 - r, W),
    at(0.7, w(0.7)), at(0.35, w(0.35)), at(0, w(0)), at(-0.15, 0),
  ];
};

// Force a run clockwise in the renderer's y-down space. Several contours of one
// path are filled `nonzero`, so two runs that disagree about which way round
// they go punch a hole where they overlap instead of merging — which is fine
// until a thumb crosses a palm. Cheap, once, at load.
const cw = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? pts.slice().reverse() : pts;
};

// ---------------------------------------------------------------------------
// THE SHAPES, in ART units, y NEGATIVE UP, origin at the WRIST CENTRE.
//
// PALM   the palmar view. A palm mass with the fingers rising out of it as
//        four SEPARATE runs, because the gaps between spread fingers are
//        BACKGROUND and not marks — that is the single biggest thing the trace
//        changed, and the reason five fingers can be counted at 1x. Plus a
//        two-segment thumb set low on the radial side, the thenar ball as a
//        shade blob, and one crease across the palm.
// FIST   the thumbs-up. Four curled fingers as a stack of bands separated by
//        three creases (the trace found them horizontal, which is the emoji's
//        own idiom and the reason a fist reads as a fist at any size), and a
//        two-segment thumb standing out of the top on the radial side, drawn
//        UNDER the fist so its base is swallowed.
// POINT  the SAME fist — literally the same point table — with the index
//        extended in two segments with a bend at the base knuckle, and the
//        thumb folded down the near side as a darker band.
//
// The last points before and after the two +300 tails are the wrist; the tails
// are the forearm running off the bottom of the frame. Rule 1 lives there.
// ---------------------------------------------------------------------------

// -- PALM -------------------------------------------------------------------
// Left edge -19.4 at the index base, the heel narrowing to a 13.5 half-width
// wrist; right edge bulging to 22 at the little finger. Trace: 366 px across
// the palm alone, 430 px including the thumb, 644 px tip to wrist.
const PALM_MASS = cw([
  [-19.4, -53.5], [-19.6, -46], [-19.2, -38], [-18.3, -30], [-16.6, -18],
  [-14.8, -6], [-13.5, 0], [-14.6, 20], [-15.5, 300],
  [15.5, 300], [14.6, 20], [13.5, 0],
  [15.4, -7], [18.0, -16], [20.2, -28], [21.6, -40], [22.0, -50], [21.6, -54],
  [12, -54.5], [0, -55], [-10, -54.5],
]);

// base x, tip x, tip y, base width, tip width. The base y is the same for all
// four — 7.5 art below the palm's top edge, so no finger has a visible
// shoulder — and the tips splay outward, which is what "slightly spread" is.
const FINGERS = [
  [-15.0, -18.5, -89.10, 8.8, 7.0],   // index    .924 of the middle's height
  [-4.0, -5.5, -96.45, 8.6, 7.2],     // middle   1
  [7.2, 7.6, -91.05, 8.8, 7.0],       // ring     .944
  [17.8, 20.8, -77.70, 7.4, 5.9],     // little   .806
].map(([bx, tx, ty, wb, wt]) => cw(digit([bx, -46], [tx, ty], wb, wt)));

// The thumb, two segments about an interphalangeal joint at (-29.5, -39.5). It
// is set 27 art units below the finger bases and swung 55 degrees off them,
// which is the trace's own angle and is what stops it reading as a fifth
// finger somebody shortened.
const PALM_THUMB = [
  cw(digit([-15, -19], [-29.5, -39.5], 13.5, 10.5)),
  cw(digit([-28, -37], [-37.5, -51.5], 10.5, 8.0)),
];

// The thenar ball: the one place a palm is not flat. Not a region of the
// silhouette but a bulge INSIDE it, and not a circle either — it is the muscle
// that works the thumb and it lies ALONG the thumb, so it is built with the
// same rounded-capped helper the digits are and pointed the same way. It runs
// past the palm's edge at its upper end on purpose: the thumb is painted after
// it and takes that end back.
const PALM_THENAR = cw(digit([-8.5, -12], [-17.5, -31], 16, 13));

// The distal crease, higher on the radial side, running out to the ulnar edge.
const PALM_CREASE = [[-10.5, -39.4], [-3, -36.6], [5, -33.6], [12.4, -31.8]];
// The thumb's joint, across its axis.
const PALM_THUMB_JOINT = [[-32.7, -36.9], [-29, -39.5], [-25.3, -42.1]];

// -- FIST -------------------------------------------------------------------
// 36 art across against the palm's 41, and 55 tall to the top of the knuckles.
const FIST_MASS = cw([
  [-14.5, -52], [-16.6, -43.5], [-16.4, -32.5], [-15.8, -21], [-14.9, -13.5],
  [-13.4, -6], [-12.7, 0], [-14.0, 20], [-15.0, 300],
  [15.0, 300], [14.0, 20], [12.7, 0],
  [14.6, -6], [17.6, -13.5], [19.1, -21], [19.6, -32.5], [19.6, -43.5],
  // The knuckle row. Four rises with three shallow dips between them, 1.5 art
  // deep — about two pixels at 1x, which is nothing there and is exactly what
  // stops the top edge reading as a dome at 3x.
  [17.9, -51], [15.0, -53.6], [11.8, -52.4], [8.6, -55.6], [4.6, -54.2],
  [0.6, -56.4], [-3.4, -54.9], [-7.4, -55.2], [-11.0, -53.6],
]);

// The raised thumb, and the two numbers that matter are the ones that make it
// NOT the pointing index. First cut had it 25 art above the knuckles, 8.8 wide,
// rising from the middle of the fist — which is the description of an index
// finger, and at 1x `approve` and `wait` were the same picture. A thumb is
// SHORT and THICK and it comes off the SIDE: 21 art of clearance against the
// index's 38, 12.5 wide against 8, and its base is over the fist's thumb flank
// (negative x, the same side `point` folds its thumb down) rather than the
// centre. The tip leans a little further out than the base, which is the last
// of it: a thumb's axis is not the forearm's.
const FIST_THUMB = [
  cw(digit([-11.5, -44], [-13.2, -63], 15.5, 12.8)),
  cw(digit([-13.0, -60], [-14.6, -76], 12.6, 11.0)),
];
const FIST_THUMB_JOINT = [[-19.2, -62.6], [-13.1, -61.8], [-7.0, -61.0]];

// The three creases between the four curled fingers. Traced at y -43.0, -31.8
// and -20.7, spanning x -7.9 to +15.8 — they stop well short of the silhouette
// at both ends, which is what keeps them creases and not cuts.
const FIST_BANDS = [
  [[-7.5, -43.6], [0, -43.1], [8, -42.7], [15.6, -42.6]],
  [[-7.5, -32.4], [0, -31.9], [8, -31.5], [15.6, -31.4]],
  [[-7.0, -21.3], [0, -20.8], [8, -20.4], [15.0, -20.3]],
];

// -- POINT ------------------------------------------------------------------
// The index, in two segments with a bend at the base knuckle: the proximal
// leans out, the distal comes back. Trace: tip at -93.75, 9.3 wide at the base.
const POINT_INDEX = [
  cw(digit([5.2, -48], [3.4, -70], 9.6, 8.0)),
  cw(digit([3.5, -68], [2.4, -93.75], 8.0, 6.6)),
];
const POINT_INDEX_JOINT = [[-0.4, -69.4], [3.5, -69.2], [7.4, -69.0]];
// The thumb, folded down the near side of the fist.
const POINT_THUMB = cw(digit([-9.5, -26], [-10.5, -50], 10.5, 9.5));
// The same three creases, started clear of the folded thumb.
const POINT_BANDS = FIST_BANDS.map((r) => r.map(([x, y], i) => [i === 0 ? -4 : x, y]));

// Mark width profiles, in upstream's units, sampled along the run 0..1.
const W_CREASE = [2, 8, 2];
const W_JOINT = [3, 7, 3];
const W_BAND = [2.5, 6, 6, 2.5];

// ---------------------------------------------------------------------------
// THE KNUCKLE BANDS, AGAIN, FOR A PEN — and why the pen cannot have the flat
// idiom's geometry here when it takes the flat idiom's geometry everywhere else.
//
// The three runs above are the trace's, and they are right for a TONE: round
// fills them with a translucent crease rung, edge to edge across the fist, and
// a tone that runs out at the silhouette has no ends to notice. Painted in the
// pen's near-black at a constant weight they are three parallel rules across a
// rounded form, they meet the silhouette line at both ends, and what a viewer
// counts at 1x is lines and not fingers — "three ruled lines" was the 1x note
// and it is the right note. Two of the three run within five art units of the
// frame's own bottom cut, which is the second-crop-line problem `lowerRegion`
// spends a paragraph on, arriving from the other direction.
//
// So the pen gets its own bands, and it is the only place in this file where an
// idiom changes a MEASUREMENT rather than a paint. Four changes, all of them
// the same idea — a crease is an EVENT on a form, not a division of it:
//
//   * SHORTENED to the middle of the traced run, so a band starts and ends over
//     bare skin and never touches the outline it would otherwise cut;
//   * STAGGERED, longest at the index/middle end of the stack and shortest at
//     the row nearest the wrist, so three marks are not one ruled grid;
//   * BOWED toward the fingertips, which are DOWN the page in a curled fist —
//     the knuckle row is this shape's top edge — so each band sags where the
//     finger's own mass is thickest;
//   * TAPERED to nothing at both ends by the ribbon below, which is the other
//     half of "no ends to notice": round's marks always had that and a stroked
//     run, whose `lineWidth` is one scalar, could not.
//
// And `wait` drops the row nearest the wrist entirely. It sits under four art
// units above the crop on that gesture — a horizontal a viewer reads against
// the frame edge rather than against the hand — and `wait` is the gesture with
// an index finger of its own to carry the read.
//
// The shortened band no longer reaches the fist's thumb flank, which retires
// `POINT_BANDS` for the pen: the whole of that table was "the same three
// creases, started clear of the folded thumb", and a band that stops at x -0.6
// was never near it. The pen therefore takes FIST's bands on both shapes.
const PEN_BAND_N = 5;                          // points per band
const PEN_BAND_KEEP = [0.70, 0.60, 0.50];      // fraction of the traced run kept
const PEN_BAND_BOW = 1.1;                      // art units of sag at mid-span
// Width along a band and along the palm crease, as fractions of the pen's mark
// width. Both end at 0: the ring closes to a point, which is the taper.
const A_BAND = [0, 0.88, 1, 0.88, 0];
const A_CREASE = [0, 1, 1, 0];
// A ribbon that peaks at the nib's own width carries LESS ink than a stroke of
// that width, because it is only that wide in the middle. The gain buys the
// difference back at the one place it is read.
const PEN_MARK_GAIN = 1.2;
// …and the alpha, which is per SHAPE because the two kinds of interior mark in
// this drawing are not the same kind of mark. See `penMarkA` in SHAPE.
const A_ONE = 1;      // one accent on a form: full ink, like `jawInk`
const A_MANY = 0.62;  // a repeated mark inside a silhouette: read after it

// The point at arc-length fraction t along an open polyline. The bands are
// four points of a near-straight run, so "the middle 58%" has to be measured
// along the run and not counted in points.
const alongRun = (pts, t) => {
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let want = clamp(t, 0, 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const u = seg[i] ? clamp(want / seg[i], 0, 1) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
    }
    want -= seg[i];
  }
  return pts[pts.length - 1].slice();
};

const penBand = (run, keep, bow) => Array.from({ length: PEN_BAND_N }, (_, i) => {
  const u = i / (PEN_BAND_N - 1);
  const [x, y] = alongRun(run, 0.5 - keep / 2 + keep * u);
  return [x, y + bow * Math.sin(Math.PI * u)];
});

const PEN_BANDS = FIST_BANDS.map((r, i) => penBand(r, PEN_BAND_KEEP[i], PEN_BAND_BOW));

// ---------------------------------------------------------------------------
// Three more build-time helpers, for the interior marks and the shade plane.
// ---------------------------------------------------------------------------

// Sample a width profile at t in 0..1.
const profile = (ws) => (t) => {
  if (ws.length === 1) return ws[0];
  const u = clamp(t, 0, 1) * (ws.length - 1);
  const i = Math.min(Math.floor(u), ws.length - 2);
  return ws[i] + (ws[i + 1] - ws[i]) * (u - i);
};

// Offset an OPEN run along its own normal. `bulge` in ../path.mjs offsets in y
// only, which is right for a brow and wrong for a thumb joint that runs at 50
// degrees; this is the same idea with the normal taken from the neighbours.
// Fixed-opcode: n points in, n points out.
const offsetRun = (pts, wAt) => {
  const n = pts.length;
  return pts.map(([x, y], i) => {
    const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    const w = wAt(n === 1 ? 0 : i / (n - 1));
    return [x - (dy / l) * w, y + (dx / l) * w];
  });
};

// A tapered interior mark, as the closed ring `strip` wants: the run pushed off
// both ways by half the profile. Widths arrive in ART units.
const ribbon = (pts, ws) => {
  const half = profile(ws.map((w) => w / 2));
  return cw(strip(offsetRun(pts, half), offsetRun(pts, (t) => -half(t))));
};

// The same, for the flat idiom's marks, whose widths are quoted in upstream's
// units because that is where they were tuned.
const mark = (pts, ws) => ribbon(pts, ws.map((w) => w * MARK_K));

// The part of a closed silhouette below a line, as its own closed run: the
// silhouette's own points from where it crosses the line, round through the two
// tails, back to where it crosses again, closed by a straight chord.
//
// This is the shade plane, and the line is TILTED rather than horizontal. Two
// separate reasons, and the second one was learnt at 1x:
//
//   * `side` mirrors the drawing in x, so a plane down one flank would be on
//     the shadow side for one hand and on the lit side for the other. A plane
//     across the BOTTOM is the same plane either way, and it is also the true
//     one: the heel of a hand held up in front of a face is the part turning
//     away from a light that is above it.
//   * but a straight horizontal edge, a dozen art units above the frame cut and
//     PARALLEL to it, is a second crop line. At 1x the first cut of this drawing
//     read as a hand resting on a shelf — two horizontals across a rounded form,
//     and the eye takes the pair for an object and its edge. `tilt` is how many
//     art units the line falls across a half-width; at 5 over 22 it is about 12
//     degrees off the crop, which is enough that the two lines stop rhyming and
//     the band reads as the heel turning under.
//
// Fixed-opcode: the two crossings and the chord's interior points are a fixed
// count, and which silhouette points are below a CONSTANT line is fixed too.
// `inset` is the one number that is not geometry: a closed Catmull-Rom rounds
// the two corners where the chord meets the silhouette, and it rounds them
// OUTWARD, which puts shade on the background beside the hand. Pulling the two
// crossings toward each other along the chord moves those corners back inside
// by more than the rounding takes them out. There is no clipping anywhere in
// this pipeline, so this is the only place to fix it.
const HALF_W = 22;
const lowerRegion = (pts, ys, { inset = 2, mids = 3, tilt = 5 } = {}) => {
  const n = pts.length, at = (i) => pts[((i % n) + n) % n];
  const lineY = (x) => ys + (tilt * x) / HALF_W;
  const below = (p) => p[1] > lineY(p[0]);
  const cross = (a, b) => {
    const fa = a[1] - lineY(a[0]), fb = b[1] - lineY(b[0]);
    const t = fa / (fa - fb);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // Seed on a point that IS below the line before walking out from it. Index 0
  // is not it: every silhouette here starts at the TOP of the shape, so seeding
  // at 0 made both `cross` calls interpolate between two points on the same
  // side of the line, `t` came out far outside 0..1, and the chord shot off as
  // a hairline sliver across the shoulder. The deepest point is always below.
  let seed = 0;
  for (let i = 1; i < n; i++) if (pts[i][1] > pts[seed][1]) seed = i;
  let i0 = seed; while (below(at(i0 - 1))) i0--;
  let i1 = seed; while (below(at(i1 + 1))) i1++;
  const a0 = cross(at(i0 - 1), at(i0)), a1 = cross(at(i1), at(i1 + 1));
  const dx = Math.sign(a1[0] - a0[0]) * inset;
  const start = [a0[0] + dx, lineY(a0[0] + dx)], end = [a1[0] - dx, lineY(a1[0] - dx)];
  const run = [start];
  for (let i = i0; i <= i1; i++) run.push(at(i).slice());
  run.push(end);
  for (let j = 1; j <= mids; j++) {
    const t = j / (mids + 1);
    run.push([end[0] + (start[0] - end[0]) * t, end[1] + (start[1] - end[1]) * t]);
  }
  return cw(run);
};

// ---------------------------------------------------------------------------
// The three shapes, as lists of runs BY PAINT. Runs that share a paint and do
// not need anything between them share a draw, which is how a drawing with
// nine digits in it still costs thirteen draws — and 26 with a pen, where a
// run that overlaps another can no longer share one (`splitAt`, below).
//
//   under   painted first, a rung darker, so the mass swallows its base
//   lit     the face rung: [ [mass], [digits] ]
//   shade   the form plane, plus any bulge inside the outline
//   marks   [run, width profile] pairs, all of them one crease-coloured draw
//
// The form line of each shape — the `lowerRegion` cut — is chosen against that
// gesture's own hold, so the visible band is the lower third of what is above
// the frame edge and its bottom runs off frame. A shade that ENDS at the crop
// draws a second edge there and the crop stops reading as a crop.
// ---------------------------------------------------------------------------

// Where a group of runs stops being disjoint, and why only a PEN cares.
//
// Every run in a `lit` or `under` group shares one flat fill, so a flat idiom
// can put all of them in one draw: overlapping fills of one colour have no
// visible edge. An OUTLINED idiom cannot. The two segments of a thumb (or of
// `wait`'s index) overlap at the joint by construction — each one's base runs
// 15% past its base point so the join has no shoulder — and two contours over
// one fill is two curves crossing where a hand has one crease. So the pen
// splits such a group at the given index and paints the far half after the near
// half's line, which is the same hidden-line removal the rest of this order is:
// the distal segment's fill covers the proximal one's cap, and what is left is
// one line across the digit.
//
// `null` is "one layer", which is what round asks for and what keeps its bytes.
const splitAt = (runs, i) => (i == null ? [runs] : [runs.slice(0, i), runs.slice(i)]);

// ...and the other half of the same problem, which `splitAt` cannot reach: a
// digit does not only overlap the digit beside it, it grows OUT OF THE MASS.
// Every base in this file is buried on purpose — `digit()` runs the base 15%
// past its base point "so the join into the palm has no shoulder" — and a flat
// idiom never sees it, because the buried end is the mass's own colour. A pen
// draws it: the four fingers came out as four capsules with rounded bottoms
// lying ON the palm, and `approve`'s thumb as a lobe with the fist's edge line
// ruled straight through it. Both are the same false line, on either side of
// the same boundary.
//
// So the pen strokes only the part of a run that is OUTSIDE the mass, and the
// fills do the rest of the work in this order:
//
//   mass fill -> shade -> MASS LINE -> digit fill -> DIGIT ARC
//
// The digit's fill covers the mass's line where the two overlap; the digit's
// arc starts and ends exactly where the mass's line reappears, because both
// endpoints are ON the mass's contour. What comes out is the union outline,
// with no clipping anywhere and no boolean geometry — two draws in the right
// order and a run cut at two points, once, at module load.
//
// Even-odd crossing test, and the first hit along a segment. Both are plain
// O(n*m) on tables of at most 26 points, run once for nine runs.
const inPoly = (p, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1])
      && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

const segHit = (a, b, poly) => {
  const rx = b[0] - a[0], ry = b[1] - a[1];
  let best = null;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const c = poly[j], d = poly[i];
    const sx = d[0] - c[0], sy = d[1] - c[1];
    const den = rx * sy - ry * sx;
    if (!den) continue;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best === null ? null : [a[0] + rx * best, a[1] + ry * best];
};

// The arc of a closed run that lies outside `mass`, as an OPEN run with its two
// ends interpolated onto the mass's boundary — or `null` for "nothing to cut",
// which is both "wholly outside" (a distal segment, whose own base cap IS the
// joint line and must stay) and "wholly inside" (`point`'s folded thumb, which
// is a line laid on the fist on purpose). A run that leaves and re-enters more
// than once is refused the same way, because none of these do and a silent
// wrong answer is worse than the line it was meant to remove.
//
// Fixed-opcode: the tables are constants, so which vertices are outside is a
// constant and so is the point count.
const carve = (run, mass) => {
  const n = run.length;
  const out = run.map((p) => !inPoly(p, mass));
  const k = out.filter(Boolean).length;
  if (k === 0 || k === n) return null;
  let blocks = 0, i0 = -1;
  for (let i = 0; i < n; i++) if (out[i] && !out[(i + n - 1) % n]) { blocks++; i0 = i; }
  if (blocks !== 1) return null;
  let i1 = i0;
  while (out[(i1 + 1) % n]) i1++;
  const A = segHit(run[i0], run[(i0 + n - 1) % n], mass);
  const B = segHit(run[i1 % n], run[(i1 + 1) % n], mass);
  const arc = A ? [A] : [];
  for (let i = i0; i <= i1; i++) arc.push(run[i % n]);
  if (B) arc.push(B);
  return arc;
};

const SHAPE = {
  PALM: {
    under: [],
    lit: [[PALM_MASS], [...FINGERS, ...PALM_THUMB]],
    shade: [lowerRegion(PALM_MASS, -32), PALM_THENAR],
    marks: [[PALM_CREASE, W_CREASE], [PALM_THUMB_JOINT, W_JOINT, 'joint']],
    // Pen only: the same crease, the joint dropped (the distal segment's own
    // contour is that line), and the widths solved on the way out. See below.
    penMarks: [[PALM_CREASE, A_CREASE]], penMarkA: A_ONE,
    // Pen only: where the runs of a group stop being disjoint. See `splitAt`.
    split: { 1: 5 },   // the four fingers and the thumb's root, then its tip
  },
  FIST: {
    // The raised thumb is the whole of this gesture and it is in the SAME light
    // as the fist: `underLit`. It is still painted first so the mass swallows
    // its base — under, but not darker.
    under: FIST_THUMB, underLit: true,
    lit: [[FIST_MASS]],
    shade: [lowerRegion(FIST_MASS, -28)],
    marks: [[FIST_THUMB_JOINT, W_JOINT, 'joint'], ...FIST_BANDS.map((b) => [b, W_BAND])],
    penMarks: PEN_BANDS.map((b) => [b, A_BAND]), penMarkA: A_MANY,
    split: { under: 1 },
  },
  POINT: {
    // This thumb is tucked at the side of the fist rather than raised, so here
    // the darker rung is the point: it is the part of the hand turned away.
    under: [POINT_THUMB], underLit: false,
    lit: [[FIST_MASS], POINT_INDEX],
    shade: [lowerRegion(FIST_MASS, -28)],
    marks: [[POINT_INDEX_JOINT, W_JOINT, 'joint'], ...POINT_BANDS.map((b) => [b, W_BAND])],
    // Two bands, not three: the row nearest the wrist goes on this gesture.
    penMarks: PEN_BANDS.slice(0, 2).map((b) => [b, A_BAND]), penMarkA: A_MANY,
    split: { 1: 1 },
  },
};
for (const s of Object.values(SHAPE)) {
  s.markRuns = s.marks.map(([p, w]) => mark(p, w));
  // every point the shape owns, for checkFraming
  s.hull = [...s.under, ...s.lit.flat(), s.shade[0]].flat();
  // Pen only, and computed here rather than in `draws` because it is geometry
  // and geometry in this file is a constant: the arc of every digit and every
  // thumb segment that is not swallowed by the mass it grows from. `null` per
  // run means "stroke the closed run" — see `carve`.
  const mass = s.lit[0][0];
  s.penUnder = s.under.map((r) => (s.underLit ? carve(r, mass) : null));
  s.penLit = s.lit.map((grp, i) => (i === 0 ? grp.map(() => null) : grp.map((r) => carve(r, mass))));
}

// ---------------------------------------------------------------------------
// THE GESTURES. Upstream's four timelines, reparametrised.
//
// Upstream keys in MILLISECONDS against its own duration, and its `dy` keys
// are absolute distances below a bottom edge that is 200 units under peep's
// chin. Neither survives a change of framing, so both were re-expressed:
//
//   * the KEY is `progress`, the fraction of the gesture the mixer sends. So
//     `dur` is documentation and the shape of the motion is duration-free.
//   * `out` is in ART units — a multiple of the hand's own size — so the hand
//     sits the same distance from the head whatever the frame is.
//   * `dy` is a TRAVEL FRACTION `up`, from HIDE toward the gesture's `hold`:
//     `dy = HIDE - up * (HIDE - hold)`. That keeps everything the curve was
//     carrying — the ballistic placement (55-74% of the rise inside the first
//     12% of the gesture), the ~2% overshoot and settle, the breathing hold,
//     the steeper exit — and lets `hold` be solved for OUR frame.
//
// `hold` is in art units and is solved from the CROP rather than from a
// station: `hold = crop * sc`, where `crop` is how far above the wrist the
// frame's bottom edge falls. Sixteen to eighteen art units up is where the heel
// has already lost a fifth of its width, so the narrowing shows and the wrist
// does not (rule 1). What comes out, as a fraction of the distance from the
// bottom edge to the chin (464.5 design units on round), is rule 3:
//
//   greet     0.725  fingertips at the neck, a clear head-height below the chin
//   farewell  0.728  the same, a hair higher, because it waves longer
//   approve   0.728  the fist at the neck, and the THUMB alone above it
//   wait      0.820  the index highest of the four, and still short of the chin
//
// Three of those four are the same number, and that is the floor talking: at
// this size rule 1 binds before rule 3 does, so `hold` is not free to place
// greet lower than approve any more. The only gesture with room above it is
// `wait`, and it is the one that is supposed to have room.
//
// `sc` is depth: how far the hand is pushed toward the lens. A thumbs-up is
// pushed at the camera and a wave is thrown out to the side, which is why
// `approve` is the biggest and `greet` the smallest. Upstream's four ratios,
// all four scaled by 0.96 — the last 4% of the area match against peep.
//
// `rot` is in degrees and is scale-free, so it is upstream's, unchanged. The
// swings are what makes a wave a wave: three for greet, four for farewell,
// and a near-still hold for the other two.
// ---------------------------------------------------------------------------

export const GESTURES = {
  greet: {
    dur: 1250, shape: 'PALM', sc: 0.67, hold: 12.73, swings: 3,
    out: [[0, 0], [0.12, 30.833], [0.24, 47.5], [0.80, 47.5], [1, 12.5]],
    up: [[0, 0], [0.12, 0.6399], [0.24, 1.0230], [0.312, 0.9847], [0.56, 1.0038],
      [0.80, 0.9885], [0.896, 0.8391], [1, 0]],
    rot: [[0, -3], [0.12, 2], [0.248, 16], [0.38, -2], [0.512, 16], [0.644, -1],
      [0.776, 12], [0.80, 8], [1, -3]],
  },
  farewell: {
    dur: 1550, shape: 'PALM', sc: 0.67, hold: 12.40, swings: 4,
    out: [[0, 0], [0.10968, 31.667], [0.20645, 48.333], [0.83871, 48.333], [1, 13.333]],
    up: [[0, 0], [0.10323, 0.6505], [0.20645, 1.0250], [0.26452, 0.9834],
      [0.45161, 1.0061], [0.64516, 0.9871], [0.83871, 0.9985], [0.91613, 0.8434], [1, 0]],
    rot: [[0, -3], [0.10968, 2], [0.21290, 16], [0.32903, -2], [0.44516, 16],
      [0.56129, -2], [0.67742, 16], [0.79355, -1], [0.83871, 8], [1, -3]],
  },
  approve: {
    dur: 1300, shape: 'FIST', sc: 0.79, hold: 12.64, swings: 0,
    out: [[0, 0], [0.12308, 22.5], [0.23077, 35], [0.80769, 35], [1, 13.333]],
    up: [[0, 0], [0.12308, 0.7421], [0.23077, 1.0204], [0.30, 0.9870],
      [0.53846, 1.0019], [0.80769, 0.9907], [0.89231, 0.8423], [1, 0]],
    rot: [[0, -6], [0.12308, -2], [0.23077, 3], [0.30769, 0], [0.53846, 1.5],
      [0.76923, 0], [0.80769, 0], [1, -8]],
  },
  wait: {
    dur: 1700, shape: 'POINT', sc: 0.75, hold: 12.75, swings: 0,
    out: [[0, 0], [0.10, 25], [0.18824, 40], [0.82353, 40], [1, 14.167]],
    up: [[0, 0], [0.10, 0.6257], [0.18824, 1.0277], [0.24118, 0.9860],
      [0.41176, 1.0011], [0.64706, 0.9879], [0.82353, 0.9973], [0.89412, 0.8305], [1, 0]],
    rot: [[0, -7], [0.10, -2], [0.18824, 2], [0.24706, 0], [0.47059, 1],
      [0.70588, -0.5], [0.82353, 0], [1, -9]],
  },
};

// The depth each SHAPE is drawn at, which is a property of the shape and not of
// the gesture only because the two waves happen to agree: greet and farewell
// are both PALM at 0.67, approve is FIST, wait is POINT. The pen needs it — a
// filled ribbon scales with `sc` where a stroke's `lineWidth` does not, and the
// mark has to come out the same weight on screen either way — so the agreement
// is asserted here rather than assumed at the call site. A fifth gesture that
// reused a shape at a new depth would fail the build, which is the right place
// to find out.
const SHAPE_SC = {};
for (const [name, g] of Object.entries(GESTURES)) {
  if (SHAPE_SC[g.shape] != null && SHAPE_SC[g.shape] !== g.sc) {
    throw new Error(`hand: ${name} draws ${g.shape} at depth ${g.sc}, not ${SHAPE_SC[g.shape]}`);
  }
  SHAPE_SC[g.shape] = g.sc;
}

// Smoothstep between keys, upstream's easing. Linear between two keys of a
// ballistic curve is what an arc-less rig looks like: the hand arrives, stops
// dead, and reads as a sprite being placed.
const smoothstep = (t) => t * t * (3 - 2 * t);

export function sample(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
    }
  }
  return last[1];
}

// ---------------------------------------------------------------------------
// makeHand
// ---------------------------------------------------------------------------

/**
 * @param {object}   o
 * @param {object}   o.P        the avatar's parameter block (unused geometry-
 *   side; taken so the part has the same front door as the others and so a
 *   future idiom can reach the character's own proportions)
 * @param {object}   o.PALETTE  needs `face` and an opaque plane a rung below it
 *   (`deep`, or `neck`, or last resort `shade`), plus `crease` — but only when
 *   there is no `pen`: a pen draws every interior mark as a LINE, so an
 *   outlined style is never asked for a crease rung it does not have. (ink's
 *   palette has none: `makePalette` there ends at the translucent overlays.)
 * @param {Function} o.solid    the paint registry's `solid`
 * @param {object}   o.frame    { cx, bottom, reach, outboardLimit }
 * @param {?object}  o.pen      the ink idiom's outline:
 *   `{ paint, w, mark, cap, join }`. `w` is the silhouette's stroke width and
 *   `mark` the interior marks', both in ARTBOARD units and both construction
 *   constants — `rig.js` copies a stroke from base to out and never blends it,
 *   so a pen width can never be a channel and a pen line never tapers. Off by
 *   default: round has no outlines and its bytes do not move when this is null.
 * @param {string}   o.group    the draw group. NOT the head group and NOT the
 *   body group: the hand is in frame space and neither the head matrix nor the
 *   breath rise may reach it (src/live.js reads `meta.live.hand.slots`).
 */
export function makeHand({ P, PALETTE, solid, frame, pen = null, group = 'hand' }) {
  const { cx, bottom, reach } = frame;
  // The paints are resolved on the FIRST draw and not here, which is a
  // one-line rule with a byte behind it: a paint registry hands out indices in
  // the order it is first asked, so a part that registers at CONSTRUCTION time
  // puts its colours in front of the face's and renumbers every draw in the
  // rig. This part reuses three paints the face has already asked for by the
  // time the hand is drawn, so asking late costs nothing and asking early
  // costs a rebuild of every file. Three Map lookups on the first frame.
  //
  // THREE TONES, and the middle one is not `PALETTE.shade`. That entry is the
  // face's side plane and it is TRANSLUCENT on purpose (round: 17% warm brown),
  // which works there because there is always skin under it. Nothing is under
  // the hand: it is the frontmost thing in the frame, over the shirt and over
  // the background. Painted at 17% the heel plane vanished against skin and the
  // raised thumb came out a green ghost over the tee — measured (91,111,94),
  // which is neither a hand colour nor a shirt colour. So the plane takes an
  // OPAQUE rung a step below the lit one; `neck` already is exactly that (one
  // skin rung down, opaque) and costs no new paint. The crease may stay
  // translucent: every mark is inside the silhouette with skin beneath it.
  let paint = null;
  const paints = () => (paint || (paint = {
    face: solid(PALETTE.face),
    deep: solid(PALETTE.deep || PALETTE.neck || PALETTE.shade),
    crease: pen ? solid(pen.paint) : solid(PALETTE.crease),
    pen: pen ? solid(pen.paint) : 0,
  }));
  // The one stroke descriptor, built once. `stroke.paint` is deliberately not
  // among its keys — `render2d.js` strokes with the DRAW's paint and
  // `validate.mjs` refuses a rig that carries a field nothing reads.
  //
  // There is no second nib for the marks any more, and that is the whole of the
  // taper: a stroke's `lineWidth` is ONE SCALAR for the length of the run, so a
  // stroked mark ends in a blunt round cap and cannot do anything else. The pen
  // draws its marks as filled ribbons instead — the same tapered ring round
  // fills, in the pen's own colour — which costs no draw (the marks were
  // already one draw per shape) and buys ends that go to a point.
  const nib = (w) => ({ w, cap: pen.cap || 'round', join: pen.join || 'round' });
  const PEN_SIL = pen ? nib(pen.w) : null;

  // …and the ribbons themselves, once, here rather than at module load, because
  // their width is the only geometry in this file that is NOT in art units:
  // `pen.mark` is a distance on the artboard, the way a `lineWidth` is, and it
  // has to come out that thick on screen whatever the frame and whatever the
  // gesture's depth. Solving `art = mark / (reach * sc)` is what holds the mark
  // to one nib the way a stroke did — see SHAPE_SC — and it is the reason a
  // ribbon can replace a stroke without the drawing getting heavier when the
  // hand is pushed at the lens.
  const penMarks = {};
  if (pen) {
    const wm = pen.mark || pen.w;
    for (const [key, s] of Object.entries(SHAPE)) {
      const w = (wm * PEN_MARK_GAIN) / (reach * SHAPE_SC[key]);
      penMarks[key] = s.penMarks.map(([run, prof]) => ribbon(run, prof.map((k) => k * w)));
    }
  }

  // The affine, once per run per frame: rotate about the wrist, scale by depth
  // (and MIRROR in x by `dir`, which is what makes one drawing two hands), then
  // translate to the placement. `reach` is folded into the scale so the tables
  // above stay in art units.
  const place = (pts, x, y, rot, sc, dir) => {
    const r = (rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    const kx = -dir * sc * reach, ky = sc * reach;
    return pts.map(([px, py]) => [
      x + kx * (px * cs - py * sn),
      y + ky * (px * sn + py * cs),
    ]);
  };

  // Where a shape sits at `t` through its gesture, or parked.
  const at = (g, t, dir) => (g
    ? {
      x: cx + dir * sample(g.out, t) * reach,
      y: bottom + (HIDE - sample(g.up, t) * (HIDE - g.hold)) * reach,
      rot: sample(g.rot, t), sc: g.sc, dir,
    }
    : { x: cx, y: bottom + HIDE * reach, rot: 0, sc: 1, dir });

  /**
   * @param {?{gesture:?string, progress:number, side:string}} h  a HandFrame
   * @param {object} env  unused; the part convention's fourth argument
   */
  function draws(h, env = {}) {
    const out = [];
    const push = drawPusher(out);
    const C = paints();

    const g = h && GESTURES[h.gesture] ? GESTURES[h.gesture] : null;
    const t = g ? clamp(typeof h.progress === 'number' ? h.progress : 0, 0, 1) : 0;
    const dir = h && h.side === 'left' ? -1 : 1;
    const p = at(g, t, dir);
    const T = (pts) => spline(place(pts, p.x, p.y, p.rot, p.sc, p.dir), 1);
    const many = (runs) => contours(...runs.map(T));
    // The same, with two free ends: what a pen's interior marks are, and what a
    // carved silhouette arc is, where a flat idiom fills a tapered ring or
    // buries the end in the mass instead.
    const TO = (pts) => openSpline(place(pts, p.x, p.y, p.rot, p.sc, p.dir), 1);
    // A pen's layer: runs paired with their carved arc (`null` = stroke the
    // closed run), split where the group stops being disjoint. The fill is
    // always the whole run; only the LINE is cut.
    const layers = (runs, arcs, k) => splitAt(runs.map((r, i) => [r, arcs[i]]), k);
    const fillOf = (L) => many(L.map(([r]) => r));
    const inkOf = (L) => contours(...L.map(([r, c]) => (c ? TO(c) : T(r))));

    // All three shape sets, every frame, with alpha choosing between them —
    // three topologies cannot be one interpolatable draw and pretending they
    // can is how a display list stops being interpolatable.
    for (const [key, s] of Object.entries(SHAPE)) {
      const a = g && g.shape === key ? 1 : 0;
      const n = key.toLowerCase();
      // ---- THE FLAT IDIOM ------------------------------------------------
      // Thirteen draws, and round's bytes are this branch: nothing below it
      // may be reachable with `pen` null.
      //
      // UNDER first: `approve`'s thumb and `point`'s folded thumb go beneath
      // the mass they belong to, so the mass swallows their base and they
      // emerge exactly as far as they should. Then MASS, the planes, and the
      // DIGITS on top of them. That order is not arbitrary and it is not
      // back-to-front either: the thenar ball is a bulge of the palm and the
      // thumb lies over it, so a shade drawn after the digits painted that ball
      // on top of its own thumb. Everything the shade draw contains belongs to
      // the mass; nothing in it belongs in front of a finger.
      if (!pen) {
        if (s.under.length) {
          push(`hand/${n}Thumb`, group, many(s.under), s.underLit ? C.face : C.deep, a);
        }
        push(`hand/${n}`, group, many(s.lit[0]), C.face, a);
        push(`hand/${n}Shade`, group, many(s.shade), C.deep, a);
        for (let i = 1; i < s.lit.length; i++) {
          push(`hand/${n}Digits`, group, many(s.lit[i]), C.face, a);
        }
        push(`hand/${n}Marks`, group, many(s.markRuns), C.crease, a);
        continue;
      }

      // ---- THE INK IDIOM -------------------------------------------------
      // Twenty-six draws, in one order that is nothing but hidden-line removal
      // in a pipeline with no clipping: every line is drawn, and then whatever
      // covers it is drawn over it.
      const split = s.split || {};
      // A FOLDED thumb is a PLANE, not a silhouette — `point`'s clears the
      // fist's edge by under 1.5 art units, so it is invisible in any idiom.
      // Its tone goes under the mass; its line goes over it, below.
      if (s.under.length && !s.underLit) {
        push(`hand/${n}Thumb`, group, many(s.under), C.deep, a);
      }
      push(`hand/${n}`, group, many(s.lit[0]), C.face, a);
      push(`hand/${n}Shade`, group, many(s.shade), C.deep, a);
      // The mass's line goes AFTER its shade plane — which would otherwise eat
      // the inner half of it, the reason ink's face draws `faceInk` after its
      // own shadow band — and BEFORE everything that grows out of the mass.
      push(`hand/${n}Ink`, group, many(s.lit[0]), C.pen, a, { stroke: PEN_SIL });
      // …and here is the folded thumb: a LINE laid over the fist, because in an
      // outlined idiom a fold is a line. Round says the same thing with a tone,
      // which is the only way a flat style can say it.
      if (s.under.length && !s.underLit) {
        push(`hand/${n}ThumbInk`, group, many(s.under), C.pen, a, { stroke: PEN_SIL });
      }
      // A RAISED thumb IS part of the silhouette. Its fill comes after the
      // mass's line and cuts that line out of itself; its own line is only the
      // arc outside the fist (`carve`), so the two read as one contour instead
      // of a lobe with a chord ruled through it.
      if (s.under.length && s.underLit) {
        layers(s.under, s.penUnder, split.under).forEach((L, j) => {
          const slot = `hand/${n}Thumb${j ? j + 1 : ''}`;
          push(slot, group, fillOf(L), C.face, a);
          push(`${slot}Ink`, group, inkOf(L), C.pen, a, { stroke: PEN_SIL });
        });
      }
      // The digits, the same way: fill cuts the mass's top edge out from under
      // the fingers growing through it, and the carved arc picks that edge back
      // up at both ends.
      for (let i = 1; i < s.lit.length; i++) {
        layers(s.lit[i], s.penLit[i], split[i]).forEach((L, j) => {
          const slot = `hand/${n}Digits${j ? j + 1 : ''}`;
          push(slot, group, fillOf(L), C.face, a);
          push(`${slot}Ink`, group, inkOf(L), C.pen, a, { stroke: PEN_SIL });
        });
      }
      // THE MARKS, and this is the one draw where the pen does NOT take the flat
      // idiom's geometry: `penMarks` above, shortened, staggered, bowed and one
      // band lighter on `wait`. The JOINTS are gone from both — the distal
      // segment's own contour already draws a line across the digit exactly
      // there, and two of them is the double line this drawing spends its whole
      // paint order avoiding.
      //
      // Alpha, per shape, and it is ink's own tiering rather than a fudge.
      // `avatars/ink/face.mjs` draws an EDGE and a lone accent at full ink
      // (`faceInk`, `jawInk`, `noseInk`, `chinInk`) and a mark that REPEATS
      // inside a feature translucent — 0.58 for the eyelid crease, 0.42 for the
      // tooth separators, whose own comment is "gaps, not a barcode". The palm
      // crease is the first kind: one accent on a bare palm, and it is the mark
      // that says the palm is a palm. The knuckle bands are the second: three
      // of them at full ink out-weigh the fist they are drawn inside, which is
      // what a barcode is, in a hand.
      push(`hand/${n}Marks`, group, many(penMarks[key]), C.pen, a * s.penMarkA);
    }
    return out;
  }

  return { rest: handRest(), draws, frame, place, at };
}

// ---------------------------------------------------------------------------
// checkFraming — rule 4, and rule 1, as an assertion the build runs.
//
// It walks every gesture at 2% steps, transforms every point the shape owns
// (rotation included: the swing is most of the budget), and reports the worst
// outboard excursion and the smallest wrist drop. It is exported rather than
// run here because a part does not know what frame it is going to be given.
// ---------------------------------------------------------------------------

export function checkFraming(frame) {
  const { reach, outboardLimit } = frame;
  const rows = [];
  for (const [name, g] of Object.entries(GESTURES)) {
    const pts = SHAPE[g.shape].hull;
    let worst = 0, drop = Infinity, top = -Infinity;
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const ox = sample(g.out, t) * reach;
      const dy = (HIDE - sample(g.up, t) * (HIDE - g.hold)) * reach;
      const r = (sample(g.rot, t) * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
      for (const [px, py] of pts) {
        // the forearm tails: below the frame by construction, and a 16-degree
        // swing about a point 300 art units away would report an excursion the
        // viewer never sees.
        if (py > 100) continue;
        const x = ox + g.sc * reach * (px * cs - py * sn);
        const y = dy + g.sc * reach * (px * sn + py * cs);
        worst = Math.max(worst, Math.abs(x));
        top = Math.max(top, -y);
      }
      drop = Math.min(drop, dy);
    }
    rows.push({ gesture: name, outboard: worst, limit: outboardLimit, wristDrop: drop, rise: top });
    if (worst > outboardLimit) {
      throw new Error(`hand: ${name} pushes ink ${worst.toFixed(0)} from centre, past ${outboardLimit.toFixed(0)}`);
    }
    if (drop <= 0) throw new Error(`hand: ${name} brings the wrist into the frame`);
  }
  return rows;
}
