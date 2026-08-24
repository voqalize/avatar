// ---------------------------------------------------------------------------
// author/parts/eye.mjs — the round idiom's eye (lids, iris stack, lashes,
// crease and BROW), as a PART, driven in the DRIVER's channel space.
//
// The part convention is written out in full at the top of ./mouth.mjs and in
// ./README.md; the one thing this part does differently is that it is drawn
// PER SIDE. `draws(c, L, side, env)` returns the eighteen draws of ONE eye, in
// paint order, with the side's `L`/`R` suffix already on every slot name — the
// avatar calls it twice, `for (const side of [-1, 1])`.
//
//   CONSTRUCTION (build time, once per persona)
//     makeEye({ P, PALETTE, solid, irisBase, lashWeight, browWeight, group })
//     `irisBase`, `lashWeight` and `browWeight` are the three places the
//     persona reaches into this geometry: the solved base iris paint (the one
//     paint the 39-rung hue ladder swaps), the lash's mass, and the brow's
//     half-thickness about its own centre line.
//
//   DRIVING  part.draws(c, L, side, env) -> ordered draws for that side
//   REST     eyeChannelRest() -> the `eye:`/`eyeL:`/`eyeR:` blocks of the
//            control vector; `part.rest` is the same object.
//   TABLES   EYE_TABLE (the six eye states) and GAZE_TABLE (the four optional
//            `gaze/*` poses) live here too, because a table written in channel
//            units is a statement about what these channels DO and belongs
//            next to the code that spends them.
//
// ---------------------------------------------------------------------------
// THE DRIVER BLOCK (phase 2). Voqalize's eye + brow channels, per side, plus
// two part-local extras this idiom cannot express without.
//
//   channel      rest   range        sign / meaning
//   lid          0.12   0..1         0 = wide open, 1 = shut. Rest is 0.12 and
//                                    that is not "nearly open": the lid must
//                                    already GRAZE the iris at rest (below).
//   squint       0.0    0..1         lower lid raised, independent of `lid`
//   pupilX       0.0   -1..1         gaze, + = viewer's RIGHT (screen +x)
//   pupilY       0.05  -1..1         gaze, + = DOWN. Rest is 0.05, a hair
//                                    below level.
//   browRaise    0.0   -1..1         whole brow up (+) / down (-)
//   browAngle    0.0   -1.4..1.4     + = OUTER end up (voqalize's browAngle*)
//   browInner    0.0   -1..1         + = INNER end up (AU1, worry)
//
//   PART-LOCAL, no counterpart in the contract, kept because this idiom's
//   closed eye is a drawn curve rather than a bean that shrinks:
//   curveUp      0.0                 bows the CLOSED lid line into a ^ or a v
//                                    — what makes happy_closed an arch and not
//                                    a slit. voqalize says that with squint +
//                                    brow; we keep the mark.
//   outerDroop   0.0                 outer canthus falls (the sad eye).
//
//   `c.eyeSize` / `c.eyeSpace` stay IDENTITY morphs on the outer vector
//   (`morph/eyes_±100`, `morph/distance_±100`), not performance channels.
//
// SIDEDNESS, and how a patch is written. The contract is per side (lidL/lidR,
// squintL/squintR, browRaiseL/R…); writing every table entry twice would be a
// tax paid on the 95% of poses that are symmetric. So the vector carries THREE
// blocks and the part reads them through `eyeSide(c, side)`:
//
//   eye:  { … }   both eyes
//   eyeL: { … }   overrides for the viewer's-left eye  (side -1, slots …L)
//   eyeR: { … }   overrides for the viewer's-right eye (side +1, slots …R)
//
//   ctrl({ eye: { lid: 0.12 } })                    both lids graze
//   ctrl({ eye: { lid: 0.12 }, eyeR: { lid: 1 } })  …and a wink on the right
//
// `makeCtrl`'s patch is a one-level Object.assign, so all three blocks merge
// per key exactly like `mouth:` does, and a symmetric state stays one line.
// GAZE is deliberately NOT mirrored: `pupilX` is screen space, so both eyes
// carry the same sign and the pair looks at one point rather than crossing.
//
// THE OLD UNITS, and where they went. The px this part was tuned in have not
// been thrown away — they are the constants below, which is what makes the map
// auditable rather than a re-tune:
//
//   open 0..1.3  ->  lid 1..0   through LID_TOP/LID_MEET/LID_GAMMA, chosen so
//                    lid = 0.12 lands the upper apex on the OLD rest px to the
//                    second decimal, and lid = 0 lands it within 1.3 px of the
//                    old `open: 1.30` wide.
//   lowerRaise   ->  squint     same 0..1 number, new name.
//   browRaise px ->  browRaise * BROW_PX.raise   (18 px per unit)
//   browInner px ->  browInner * BROW_PX.inner   (26 px per unit)
//   browOuter px ->  browAngle * BROW_PX.angle   (11 px per unit)
//
// The brow's LANDMARKS (`bwI/bwM/bwO`) are still solved in the avatar's own
// `landmarks(c)` — that is where those three channels are actually spent,
// because brow height carries a little of the forehead mesh with it and the
// mesh is not the part's to own. `BROW_PX` is exported so the avatar spends
// them in this part's units.
// ---------------------------------------------------------------------------

import { spline, openSpline, arc, shift, circle, strip, band, bulge, contours, ring } from '../path.mjs';
import { clamp, lerp, drawPusher } from '../rig.mjs';

// --- the front door: every scale constant the channel map is made of --------

export const LID_REST = 0.12;     // the contract's rest lid, and ours
export const PUPIL_Y_REST = 0.05; // …and its rest gaze, a hair below level

// The lid curve. `LID_TOP` is where the upper apex sits at lid = 0, in units of
// P.eyeTopH ABOVE the eye centre; `LID_MEET` is where the two lids touch at
// lid = 1, in units of P.eyeBotH BELOW it; `LID_GAMMA` bends the ride between
// them. Gamma is the whole of "a wide eye opens the top far more than a sleepy
// eye closes it": the aperture is steep at the open end, so lid 0.12 -> 0 lifts
// the upper apex 19.8 px while lid 0.12 -> 0.26 drops it 20.2 px, and the HALF
// state's aperture lands at 0.76 of rest against the reference sheet's 0.775.
//
// The one place this deliberately falls short of the reference is WIDE: the
// sheet's wide upper apex is 1.70x its open one, and 1.54 puts ours at 1.41x
// (113 px of aperture against 92). That is not a miss, it is this eye's own
// proportion — the reference eye is an almond whose OPEN aperture is 0.475 of
// its width, ours is a round one at 0.59, and taking a rounder eye out to 1.70
// puts the whole iris inside the opening with white all round it, which is a
// startle and not an alert. 1.54 also lands lid = 0 within 1.3 px of the widest
// px this rig ever drew (the old `open: 1.30`), so nothing that was tuned
// against the wide state has moved under it.
const LID_TOP = 1.54;
const LID_MEET = 0.60;
const LID_GAMMA = 1.9;

// The lower lid. It is parked at its open position until the eye is nearly
// shut (`LID_LO_KNEE`), because the upper lid does almost all of a blink; it
// takes `SQUINT_LIFT` of the eye's lower half at squint = 1; and it drops a
// LITTLE further, but only as the eye opens PAST rest, which is the reference
// sheet exactly: its WIDE cell puts the lower arc at 1.08x open while its HALF
// cell leaves it untouched. Hence the one-sided `max` at the call site rather
// than a symmetric term — a narrowing eye does not lift its lower lid, that is
// what `squint` is for.
const LID_LO_KNEE = 0.32;
const SQUINT_LIFT = 1.45;
const LID_LO_WIDEN = 0.73;

// `curveUp`, in px of lift at 1.0 — the part-local channel that bows the CLOSED
// lid line. It has to out-reach `LID_MEET`: the seam is parked 24 px BELOW the
// canthus line so a plain blink dips the way the reference sheet's CLOSED cell
// does, and a happy_closed eye has to climb back over that line to read as the
// ^ it is rather than as a sad bowl. 38 puts it 14 px above the eye centre and
// 20 above the inner canthus, which is an arch you can read at 1x; at 16 (what
// this was before the seam moved down) happy_closed and idle_closed were nearly
// the same shape and the smile lived entirely in the brow.
//
// It is spent LINEARLY, not scaled by `lid`, because a smiling OPEN eye bows a
// little too — which is why EYE_TABLE's `eyes-happy` asks for 0.12 rather than
// the 0.30 it used to: at 38 px a unit, 0.12 is the same 4.6 px of bow the old
// 0.30 bought at 16, and any more of it would leave a smiling eye's upper lid
// higher than a resting one's, which is not a smile. The lower lid takes 0.81
// of the same lift, the ratio the two numbers always had.
const CURVE_UP = 44;
const CURVE_UP_LO = 0.81;
// …and the two ENDS of that line have to come with it, or the bow is tilted
// rather than an arch. The inner canthus sits 10 px BELOW the outer one (`yi`
// = ey+6, `yo` = ey-4), and `curveUp` used to lift only the middle station, so
// `happy_closed`'s apex landed ~60% of the way to the outer corner and the pair
// read cheerful rather than `^_^`. `CURVE_UP_OUT` is exactly that 10 px offset,
// spent on the OUTER endpoint, so a full curveUp levels the two canthi and the
// arch is symmetric; a NEGATIVE curveUp (`sad_closed`, -0.40) drops the outer
// corner 4 px instead, which is the falling canthus that state wants anyway.
const CURVE_UP_OUT = 10;

// Gaze travel, as a fraction of the room the iris actually has.
//
// X is the sclera half-width, less the iris radius, LESS the canthus inset —
// and that last term is the one that had to be measured rather than assumed.
// The lid arcs run all the way out to `xi`/`xo`, but the SCLERA's two corner
// points are pulled inboard of them by 9 and 10 px (`cIn`/`cOut` below), which
// leaves a thin wedge at each corner that neither the sclera nor the two lid
// plates cover. Travel computed against `hw` alone drives the iris into that
// wedge and a blue spur appears OUTSIDE the eye — which is exactly what the
// first cut of this did at 4x. So the room is `hw - CANTHUS_INSET - ir`, and
// the 0.92 is what keeps the iris edge a whisker inside the corner rather than
// on it: 25.7 px at pupilX = ±1, an iris edge at 67.7 against a corner at 68.
//
// That is a smaller number than "hard against the canthus" and it is the right
// one: an iris whose rim touches the corner reads as an eye about to pop, and
// the caricature economy wants ±1 to be an extreme a driver can actually hold.
//
// Y is a fraction of the iris radius: there is no room under the lids for a
// whole-iris travel, and there should not be, since an eye that looks down
// tucks its iris UNDER the lower lid — the lid plates are painted over the
// stack, so that tuck costs nothing and is the whole read of a look-down.
const CANTHUS_INSET = 10;
const GAZE_X_K = 0.76;
// Y is split by DIRECTION, and that is not symmetry for its own sake. Nothing
// in `uMid`/`lMid` reads `pupilY`: the lid does not follow the gaze in the
// part, ON PURPOSE — voqalize's mixer owns that (it applies `lidBias =
// pupilY·0.34`), and baking it here too would double-apply it. So an unmixed
// `gaze/down` at -1 is an iris that has dropped under a lid that has not
// moved, which reads STARTLED — sclera above the iris. 0.36 down against 0.55
// up keeps the pose honest on its own and still leaves the mixer its half.
const GAZE_Y_K = { up: 0.55, down: 0.36 };

// Brow channels, in px per unit of channel. Spent by the avatar's landmark
// solver, not here; exported so there is one place to read them from.
export const BROW_PX = { raise: 24, inner: 26, angle: 11 };

// The same three channels, spent AGAIN and on something else: the brow's own
// SHAPE. `BROW_PX` above moves the three landmarks, which is a translation of
// the mark plus the forehead mesh it drags; a brow that only translates says
// almost nothing, because what a brow means is in its ARCH and its TILT. These
// are px of shape per unit of channel, on top of that travel:
//
//   arch/archIn  browRaise lifts the peak more than the head, so raising is a
//                brow gaining curvature and lowering is one going flat — the
//                difference between "interested" and "moved up 5 px".
//   tilt         browAngle rotates the whole mark about its middle station,
//                outer end up and inner end DOWN. voqalize pivots the tail
//                alone; the tail alone at this size is under 2 px at 1x.
//   tip/cap      browInner lifts the inner END, and lifts its rounded cap
//                further still, so the head of the brow ROTATES up rather
//                than sliding — which is the whole read of AU1 (worry).
//   pinch        …and draws it in toward the midline with it (the knot).
//
// They are shape, so they scale with `px` like every other length here.
const BROW_SHAPE = { arch: 9, archIn: 4, tilt: 9, tip: 9, cap: 14, pinch: 6 };

// ---------------------------------------------------------------------------
// TWO IDIOMS, ONE PART. Everything above is round's eye; ink's is the same
// SOLVE — the same lid ride, the same gaze translation, the same brow arch —
// drawn with a different set of marks and an outline pen over them. So the
// three things that differ became three CONSTRUCTION bags, merged over these
// defaults, and the defaults are round's own numbers to the byte.
//
//   px      one scale for every constant below that is a DESIGN PIXEL rather
//           than a ratio of a `P` dimension. ink's eye is 0.73 of round's
//           (eyeTopH 32 against 44), and a 13 px lid fold on a 32 px lid is a
//           different eye, not the same eye smaller. Ratios — LID_TOP,
//           SQUINT_LIFT, the catchlight offsets — are already scale-free and
//           are NOT touched by it.
//   shape   the lid/canthus geometry. Two of these are the whole difference
//           between a round eye and an almond one: `meet` (where the lids
//           touch — round's is 0.60 of the lower half, ink's 0.28, which is
//           why ink's closed eye is a line near the centre and round's is a
//           bowl) and `widest` (how far inboard of centre each lid arc peaks).
//   marks   WHICH of the layers this idiom draws, and how. A flat-fill eye
//           models with translucent planes (`water`, `lidFold`, `squintShade`)
//           where an outlined one models with LINES and would rather have the
//           pen; the two never wanted the same list.
//   catch   the catchlight pair, as offsets and radii in units of the iris
//           radius. ink's spark is half again as big and sits a little higher.
//   pen     the outline, or null for a style that has none. `{ paint, lid,
//           crease, brow, lash, cap, join }` — a paint and a width per line.
//           A draw in this runtime is stroked XOR filled, so every entry here
//           is a draw of its own laid over the fills.
// ---------------------------------------------------------------------------

export const EYE_SHAPE = {
  canthus: [6, -4],          // inner / outer canthus, px below the eye centre
  meet: LID_MEET,            // where the lids touch when shut, in P.eyeBotH
  top: LID_TOP,              // upper apex at lid = 0, in P.eyeTopH
  gamma: LID_GAMMA,
  widest: [0.04, 0.04],      // arc peak, inboard(+)/outboard(-) as a share of hw
  curveUp: CURVE_UP, curveUpLo: CURVE_UP_LO, curveUpOut: CURVE_UP_OUT,
  over: 4,                   // how far each lid plate bites into the opening
  bury: 3,                   // …and how far the sclera is buried under it
};

export const EYE_MARKS = {
  shade: 'cover',     // 'cover' = round's corner-and-crescent plane, drawn
                      // before the iris; 'crescent' = ink's cast shadow, hung
                      // off the lid arc and drawn AFTER the pupil; false = none
  glow: true,         // the iris's inner glow, offset away from the light
  limbal: 'ring',     // 'ring' = a filled evenodd annulus; 'stroke' = a pen
  water: true,        // the waterline inside the lower lid
  squintShade: true,  // the cheek roll under a raised lower lid
  lidFold: true,      // the upper lid's own thickness, as a plane
  lash: 'bulge',      // 'bulge', or a per-station height profile, in artboard units
  lashLo: true,       // two lower lash ticks at the outer corner
  crease: 'band',     // 'band' = a filled hairline; 'line' = a pen swept off the
                      // lid; an ARRAY = a pen at those per-station offsets
                      // (5 = the lid's inner stations), in artboard units; false
  lidLine: false,     // ink's lower-lid pen, faded out as the eye shuts
};

export const EYE_CATCH = { r: 0.22, at: [-0.42, -0.42], r2: 0.072, at2: [0.37, 0.37] };

// The `eye:` / `eyeL:` / `eyeR:` blocks of the control vector, at rest. The six
// named eye states, the four gaze poses and the idle clips are patches on these
// nine numbers and nothing else.
export function eyeChannelRest() {
  return {
    eye: {
      lid: LID_REST, squint: 0,
      pupilX: 0, pupilY: PUPIL_Y_REST,
      browRaise: 0, browAngle: 0, browInner: 0,
      curveUp: 0, outerDroop: 0,
    },
    eyeL: {}, eyeR: {},
  };
}

// One eye's channels: the shared block with that side's overrides on top.
export const eyeSide = (c, side) => ({ ...c.eye, ...(side < 0 ? c.eyeL : c.eyeR) });

// The eye block as `avatars/{facet,ink}` still hold it — today's px-and-ratio
// names, frozen. `author/rig.mjs` composes REST_CONTROLS out of this, so the
// two generators that are not parts yet keep the vector they were tuned
// against; `round` overrides the block with `eyeChannelRest()` on its own copy,
// which is what REST_CONTROLS' own comment says a generator that grows a
// channel should do. It goes when ink and facet become parts.
export function eyeRest() {
  return {
    open: 1,          // 1 = neutral, 0 = shut, >1 = wide
    lowerRaise: 0,    // lower lid pushes up (squint / smile)
    curveUp: 0,       // bows the closed lid line into a ^ or a v
    outerDroop: 0,    // outer corner of the upper lid falls
    browRaise: 0, browInner: 0, browOuter: 0,
  };
}

// ---------------------------------------------------------------------------
// The six eye states, in channel space. `cheekRaise` rides along because a
// Duchenne smile is not a squint alone — the cheek that raises the lower lid is
// the same cheek, and the driver reaches these states by NAME rather than by
// channel, so the state is allowed to know it. Everything MOUTH about a state
// stays in the avatar: a mouth is not the eye's to move.
//
// Read against the old table: `open: 0.86` became `lid: 0.17` through the curve
// above, `open: 1.30` became `lid: 0` (the contract's own wide), and both
// closed states became `lid: 1` — the old 0.02/0.03/0.04 were "as shut as that
// lerp got", and shut has a name now.
// ---------------------------------------------------------------------------
export const EYE_TABLE = {
  'eyes-idle_closed': { eye: { lid: 1, browRaise: -0.17 } },
  'eyes-idle_wide': { eye: { lid: 0, browRaise: 0.83 } },
  'eyes-happy': { eye: { lid: 0.17, squint: 0.44, curveUp: 0.12, browRaise: 0.67, browAngle: 0.55 }, cheekRaise: 1 },
  'eyes-happy_closed': { eye: { lid: 1, squint: 0.30, curveUp: 1.0, browRaise: 0.72, browAngle: 0.64 }, cheekRaise: 1 },
  'eyes-sad': { eye: { lid: 0.26, outerDroop: 0.9, browRaise: 0.06, browInner: 0.92, browAngle: -1.18 }, cheekRaise: -0.5 },
  'eyes-sad_closed': { eye: { lid: 1, curveUp: -0.40, outerDroop: 0.5, browRaise: 0.06, browInner: 0.92, browAngle: -1.18 }, cheekRaise: -0.5 },
};

// The four gaze poses, at the channel's own extremes, named for what a VIEWER
// sees: `gaze/left` is the eye looking towards the left of the screen, which is
// pupilX = -1 because + is the viewer's right. They are OPTIONAL vocabulary
// (src/vocab.js): a rig without them is complete, and a mixer reaches an
// arbitrary gaze by holding one of a pair at |pupilX| — the poses are linear in
// the channel by construction, since the iris stack is a pure translation.
export const GAZE_TABLE = {
  'gaze/left': { eye: { pupilX: -1 } },
  'gaze/right': { eye: { pupilX: 1 } },
  'gaze/up': { eye: { pupilY: -1 } },
  'gaze/down': { eye: { pupilY: 1 } },
};

// A point at fractional position t in [0,1] along a polyline. Used to hang the
// lower lashes off the lid arc so they ride every lid pose for free. It came
// over from the avatar with the eye: it has exactly one call site and that
// call site is here.
const onRun = (pts, t) => {
  const u = clamp(t, 0, 1) * (pts.length - 1);
  const i = Math.min(Math.floor(u), pts.length - 2), f = u - i;
  return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
};

// P keys read: eyeHalfW, eyeTopH, eyeBotH, irisR, pupilR.
// PALETTE keys read: sclera, scleraShade, eyeShade, carun, irisGlow, limbal,
//                    pupil, catch, catch2, water, face, lidFold, lash, crease,
//                    brow, browR.
// L keys read: eyeC{L,R}, bwI{L,R}, bwM{L,R}, bwO{L,R}.
// c keys read: eyeSize, eye/eyeL/eyeR.*.
export function makeEye({
  P, PALETTE, solid, irisBase, lashWeight = 1, browWeight = 1, group = 'head',
  px = 1, shape = {}, marks = {}, catch: catchOpt = {}, pen = null,
}) {
  const HEAD = group;
  const S = { ...EYE_SHAPE, ...shape };
  const M = { ...EYE_MARKS, ...marks };
  const C = { ...EYE_CATCH, ...catchOpt };
  // A stroke descriptor, or nothing. `rig.js` copies a stroke straight from
  // base to out and never blends it, so a width is a constant of the draw and
  // can never be a pose channel — which is why it is a construction input.
  const nib = (w) => ({ w, cap: (pen && pen.cap) || 'round', join: (pen && pen.join) || 'round' });
  const INK = pen ? solid(pen.paint) : null;

  function draws(c, L, side, env = {}) {
    const out = [];
    const push = drawPusher(out);

    // The eye opening's box. A pure function of `c.eyeSize` and the params, so
    // computing it per side is the same three numbers the avatar used to hoist
    // above the loop.
    const hw = P.eyeHalfW * (1 + 0.20 * c.eyeSize);
    const th = P.eyeTopH * (1 + 0.24 * c.eyeSize);
    const bh = P.eyeBotH * (1 + 0.24 * c.eyeSize);

    const k = side < 0 ? 'L' : 'R', s = side;
    const [ex, ey] = L['eyeC' + k];
    // The eye opening's two corners. Sclera, both lids and the lash line all
    // pass through exactly these points, which is what stops white slivers
    // leaking out of the corners when the lids move.
    const xi = ex - s * hw, yi = ey + S.canthus[0];   // inner canthus (sits lower)
    const xo = ex + s * hw, yo = ey + S.canthus[1];   // outer canthus (slightly up)

    const e = eyeSide(c, side);
    const lid = clamp(e.lid, 0, 1);
    const squint = clamp(e.squint, -1, 1);

    // --- lid -> px. The whole channel map, in four lines. -------------------
    // `aperture` is the ride from shut (0) to wide (1); at lid = LID_REST it is
    // 0.7838, which puts the upper apex on ey - th * 1.10 — the px this eye was
    // drawn at — and that is the number the "graze" is measured from: the lash
    // band's lower edge then lands 2.2 px INSIDE the top of the iris.
    const meet = ey + bh * S.meet;            // where the lids touch when shut
    const aperture = Math.pow(1 - lid, S.gamma);
    const uMid = lerp(meet, ey - th * S.top, aperture) - e.curveUp * S.curveUp
      + e.outerDroop * 4 * px;
    // The lower lid holds still through most of a blink and then closes late,
    // takes the squint, and opens a little further than rest when the eye goes
    // wide.
    const loOpen = ey + bh * 1.10 + Math.max(LID_REST - lid, 0) * bh * LID_LO_WIDEN
      - squint * bh * SQUINT_LIFT;
    const lMid = lerp(meet, loOpen, clamp((1 - lid) / LID_LO_KNEE, 0, 1))
      - e.curveUp * S.curveUp * S.curveUpLo;

    // A round eye wants its widest point near the middle, not pushed inboard
    // the way an almond eye does — which is exactly what `shape.widest` says.
    // The outer endpoint carries two channels of its own: `outerDroop` falls
    // (20 px at 1.0 — at 13 the sad eye's canthus barely read at 1x) and
    // `curveUp` levels it against the inner canthus (see CURVE_UP_OUT).
    const outY = yo + e.outerDroop * 20 * px + e.curveUp * S.curveUpOut;
    const up = arc([xi, yi - e.outerDroop * 2 * px], [ex - s * hw * S.widest[0], uMid],
      [xo, outY]);
    const lo = arc([xi, yi - e.outerDroop * 2 * px], [ex + s * hw * S.widest[1], lMid],
      [xo, outY]);
    const OVER = S.over;                       // how far each lid bites in
    const BURY = S.bury;

    const sTop = shift(up, -BURY);
    const sBot = shift(lo, BURY);
    const cIn = [xi + s * 9 * px, yi], cOut = [xo - s * 10 * px, yo];
    const opening = strip(sTop, sBot.slice(1, -1));
    opening[0] = cIn;
    opening[up.length - 1] = cOut;

    push('sclera' + k, HEAD, spline(opening, 0.85),
      solid(side < 0 ? PALETTE.sclera : PALETTE.scleraShade));

    // --- the lid's cast shadow, and the corners ---------------------------
    // Two idioms, one slot. `cover` is the flat-fill one: the opening's own top
    // edge, with a lower edge that is raised most in the middle (`cover` -> 0.34
    // of the sclera's local height) and not at all at the two canthi. One shape,
    // therefore, is both the crescent under the upper lid and the darkening into
    // the corners, and because both of its edges are built from the same arcs
    // the sclera is, it cannot leak past the lids in any pose. It is painted
    // BEFORE the iris, because it is the whole socket in shadow.
    if (M.shade === 'cover') {
      const shTop = opening.slice(0, sTop.length);
      const shBot = shTop.map((p, i) => {
        const t = i / (shTop.length - 1);
        // 0.50 at the canthi, 0.32 under the middle of the lid. 1.0 buried the
        // two slivers of sclera the (now larger) iris leaves and the eye read as
        // dirty; 0.66 was still dark enough at both corners that the pair read
        // as narrowed at 1x. 0.50 keeps the modelling without the squint.
        const cover = 0.50 - 0.18 * Math.pow(Math.sin(Math.PI * t), 0.7);
        return [lerp(p[0], sBot[i][0], cover), p[1] + (sBot[i][1] - p[1]) * cover];
      });
      push('eyeShade' + k, HEAD, band(shTop, shBot, 0.85), solid(PALETTE.eyeShade));
    }

    // caruncle: the pink of the tear duct, sitting in the darkened inner corner
    push('carun' + k, HEAD, spline([
      [cIn[0] + s * 1 * px, cIn[1] - 0.5 * px],
      [cIn[0] + s * 7 * px, cIn[1] - 4.5 * px],
      [cIn[0] + s * 7.5 * px, cIn[1] + 3.5 * px],
    ], 0.7), solid(PALETTE.carun));

    // --- the iris, five layers deep, and where it is LOOKING ---------------
    // iris body (the ONE paint the hue ladder swaps) -> inner glow, offset
    // down-right, away from the light -> limbal ring -> pupil -> a primary
    // catchlight upper-left and a smaller, dimmer secondary lower-right.
    //
    // GAZE is one translation of the whole stack: `ix`/`iy` slide and every
    // layer is built off them, so the eye keeps its modelling at every gaze and
    // no layer needs a pose entry of its own. Two decisions in it:
    //
    //  * The travel is clamped by CONSTRUCTION rather than by a clamp() — the
    //    scale is the room the iris has inside its own opening, measured to the
    //    SCLERA's corners rather than to the lid arcs' (see GAZE_X_K). The lid
    //    plates are painted over the stack, so the VERTICAL travel is allowed
    //    to exceed the aperture where the horizontal one is not.
    //  * The catchlights TRAVEL WITH THE IRIS, and their offsets inside it do
    //    not change. That is the compromise this style wants: physically a
    //    catchlight is a reflection in the cornea and barely moves, but a hard
    //    white dot left behind on the sclera reads as a blemish rather than as
    //    a light, while a dot that keeps its 10-o'clock offset within the iris
    //    still says "one light source, up and to the left" at every gaze. The
    //    primary is on the SAME side in both eyes (no `s` in its offset);
    //    mirroring it, which is what this rig used to do, is exactly what made
    //    the pair read as subtly cross-eyed close up.
    const ir = P.irisR * (1 + 0.16 * c.eyeSize);
    const gx = clamp(e.pupilX, -1, 1) * (hw - CANTHUS_INSET * px - ir) * GAZE_X_K;
    const dy = clamp(e.pupilY, -1, 1) - PUPIL_Y_REST;   // + is DOWN the screen
    const gy = dy * ir * (dy > 0 ? GAZE_Y_K.down : GAZE_Y_K.up);
    const ix = ex + s * 2 * px + gx, iy = ey + 2 * px + gy;
    push('iris' + k, HEAD, spline(circle(ix, iy, ir, 12), 1), solid(irisBase));
    if (M.glow) {
      push('glow' + k, HEAD, spline(circle(ix + ir * 0.07, iy + ir * 0.10, ir * 0.60, 10), 1), solid(PALETTE.irisGlow));
    }
    // The limbal ring, either way round: a filled annulus for a style that
    // models with fills, or — the research sheet's own note for an outlined one,
    // "don't double up an outline and a separate ring fill, pick one" — a STROKE
    // at the iris edge, its radius pulled in by half its own width so the ring
    // sits ON the boundary rather than outside it.
    if (M.limbal === 'stroke') {
      const w = pen.limbal || pen.lid;
      push('limb' + k, HEAD, spline(circle(ix, iy, ir - w / 2, 12), 1),
        solid(PALETTE.limbal), 1, { stroke: nib(w) });
    } else {
      push('limb' + k, HEAD, ring(ix, iy, ir, ir - ir * 0.085, 12), solid(PALETTE.limbal), 1, { rule: 'evenodd' });
    }
    push('pupil' + k, HEAD, spline(circle(ix, iy, P.pupilR * (1 + 0.16 * c.eyeSize), 10), 1), solid(PALETTE.pupil));

    // The other idiom's shadow: a crescent hung off the SAME arc the lid is, so
    // it rides the blink for free and is swallowed by the lid plate when the
    // arcs meet; deepest at the middle, zero at both canthi. It goes AFTER the
    // iris, not before it — a shadow that stops dead at the limbus reads as a
    // grey stripe painted on the white.
    if (M.shade === 'crescent') {
      push('eyeShade' + k, HEAD, band(
        shift(up, 0.6 * px),
        bulge(up, 9 * px, { floor: 0.6 * px, power: 0.6 }),
        0.85,
      ), solid(PALETTE.eyeShade));
    }

    push('catch' + k, HEAD, spline(circle(ix + ir * C.at[0], iy + ir * C.at[1], ir * C.r, 7), 1), solid(PALETTE.catch));
    push('catch2' + k, HEAD, spline(circle(ix + ir * C.at2[0], iy + ir * C.at2[1], ir * C.r2, 6), 1), solid(PALETTE.catch2));

    // --- waterline ---------------------------------------------------------
    // A soft line inside the lower lid, above the edge `lidLo` will paint over
    // (`lo - OVER`, i.e. `sBot - 7`), so a 7px band at -16..-9 stays visible
    // without floating free of the lid. It crosses the bottom of the iris,
    // which is what the real lower lid does.
    if (M.water) {
      const wl = (dy2) => bulge(sBot, -dy2, { power: 0.5 });
      push('water' + k, HEAD, band(wl(16.5 * px), wl(9.5 * px), 0.8), solid(PALETTE.water));
    }

    // Lid plates. In a faceted face these were planes in their own right; here
    // they are the face tone, and everything above is painted BEFORE them, so a
    // blink occludes the eyeball by overlap and not by a mask. They can be one
    // flat colour on both sides only because the shading plane is translucent
    // and painted after them.
    const loRun = shift(lo, -OVER);            // the lower lid's painted edge
    push('lidLo' + k, HEAD, spline([
      ...loRun,
      [xo + s * 22 * px, ey + bh + 22 * px], [ex, ey + bh + 32 * px], [xi - s * 20 * px, ey + bh + 18 * px],
    ], 0.85), solid(PALETTE.face));

    // The squint's own mark. A raised lower lid is not just a higher arc: it is
    // a roll of cheek pushed up under the eye, and without the shade under it
    // the arc reads as the lid having been TRIMMED rather than lifted — which
    // is exactly how a Duchenne smile fails. A crescent hung off the lower
    // lid's painted edge, deepest a little outboard of centre, fading in with
    // the channel. It sits on the cheek side of that edge, so it never touches
    // the sclera whatever the lid is doing.
    if (M.squintShade) {
      push('squintSh' + k, HEAD, band(
        bulge(loRun, 5 * px, { skew: 1.15 }),
        bulge(loRun, 21 * px, { skew: 1.15, power: 0.8 }), 0.85,
      ), solid(PALETTE.lidFold), clamp(squint * 1.35, 0, 1));
    }

    push('lidUp' + k, HEAD, spline([
      ...shift(up, OVER),
      [xo + s * 26 * px, ey - th - 34 * px], [ex, ey - th - 46 * px], [xi - s * 22 * px, ey - th - 30 * px],
    ], 0.85), solid(PALETTE.face));

    // The upper lid's THICKNESS. The plate above is flat face tone, so without
    // this the lid line reads as a cut in the face rather than as an edge with
    // a lid behind it: a 13 px band of lid plane, pinned to both canthi so it
    // comes to a point where the lid does, sitting between the lash below it
    // and the crease above. It rides `up`, so it is the same shape at every lid
    // value and needs no pose logic of its own.
    if (M.lidFold) {
      push('lidFold' + k, HEAD, band(
        bulge(up, -13 * px, { skew: 1.1, pin: true }), up, 0.85,
      ), solid(PALETTE.lidFold));
    }

    // The lower lid LINE — an outlined style's answer to the waterline, and the
    // one mark here whose alpha is not a channel but a consequence: both lid
    // runs converge on the same arc when the eye closes, and two coincident
    // strokes read as one lumpy heavier one. Width is not a pose channel, so
    // fading it out is the only way to say "this line is not there".
    if (M.lidLine && pen) {
      push('lidLoInk' + k, HEAD, openSpline(lo, 0.85), INK,
        clamp((aperture - 0.08) / 0.30, 0, 1), { stroke: nib(pen.lid) });
    }

    // crease: a hairline arc a little above the lash, the one bit of "line
    // work" a flat-fill style allows itself above the eye; an outlined one has
    // a pen for it and draws the same offset run with it, thinner and
    // translucent so a crease never competes with the lash line.
    // A pen crease can take its offsets from a table instead: a real fold is
    // deepest over the outer third and converges at both canthi, and five
    // authored numbers say that more exactly than any easing of a bulge does.
    const cr = shift(up, -17 * px);
    if (pen && (Array.isArray(M.crease) || M.crease === 'line')) {
      const inner = up.slice(1, -1);
      push('crease' + k, HEAD, openSpline(
        Array.isArray(M.crease)
          ? inner.map(([x, y], j) => [x, y - M.crease[j]])
          : bulge(inner, -6 * px, { floor: -8 * px, skew: 1.4, power: 0.7 }),
        0.9,
      ), INK, 0.58, { stroke: nib(pen.crease) });
    }

    // lash line: the upper arc thickened by a bump that tapers to nothing at
    // both canthi, so it comes to a point rather than a stub, plus a small
    // outward flick at the outer corner.
    // The two ends are pinned to the canthi exactly. A lash that tapers to a
    // constant +1.5px instead leaves a pair of free-floating dark whiskers
    // just outside the eye corners — invisible in the source, obvious at 2x.
    // The bulge peaks at t = 0.68 — `up` runs inner canthus -> outer, so that
    // is the outer third the research puts the mass of a lash in, not the 0.43
    // this used to peak at. The +2.2 floor is the lash line continuing inward
    // as a thin dark lid line rather than disappearing.
    // `lash.weight` scales the bump and its floor together, so a lighter lash
    // is the same line drawn thinner rather than a shorter one.
    //
    // At lid = 1 this band IS the closed eye: both arcs sit on `meet`, the
    // sclera between them has no height left, and what is on the face is one
    // curve with a lash on it, bowed 20 px below the line between the two
    // canthi. `LID_MEET` is what buys that bow — the reference sheet's CLOSED
    // cell dips 0.17 of the eye's width, and a lid that meets on the canthus
    // line reads as a drawn-on dash.
    //
    // An OUTLINED eye splits that in two: the lid line is a stroke (it is the
    // whole of a closed eye and it has to be the same pen as everything else on
    // the face), and the mass over it is a filled wedge whose profile is given
    // per station — thick at the outer third, nothing at the inner canthus, and
    // NOT pinned at the outer end, because that flick is the lash.
    const lw = lashWeight;
    if (pen && pen.lash) push('lashInk' + k, HEAD, openSpline(up, 0.85), INK, 1, { stroke: nib(pen.lash) });
    if (Array.isArray(M.lash)) {
      push('lash' + k, HEAD, band(
        up.map(([x, y], i) => [x, y - M.lash[i] * lw]),
        shift(up, (pen ? pen.lash : 0) * 0.42),
        0.9,
      ), solid(PALETTE.lash));
    } else {
      const lashB = bulge(up, 12.5 * px * lw, { floor: 2.2 * px * lw, skew: 1.8, pin: true });
      push('lash' + k, HEAD, band(up, lashB, 0.8), solid(PALETTE.lash));
    }

    // Two lower lash ticks at the outer corner and nowhere else — full lower
    // lashes turn a friendly face into a doll's. They hang off `lo - OVER` —
    // the edge `lidLo` actually paints to — not off the buried `sBot`, so they
    // ride every lid pose. Anchored 3px below that edge the whole tick lands on
    // skin and reads as a detached claw; straddling it, it reads as a lash.
    // Their alpha follows the lid so a closed eye has no lashes standing under
    // a shut lid.
    if (M.lashLo) {
      push('lashLo' + k, HEAD, contours(
        ...[[0.74, 5.5], [0.88, 4.2]].map(([t, len]) => {
          const q = onRun(loRun, t);
          return spline([[q[0] - s * 1.7 * px, q[1] - 3 * px], [q[0] + s * 2.2 * px, q[1] + len * px * lw], [q[0] + s * 1.7 * px, q[1] - 3 * px]], 0.6);
        }),
      ), solid(PALETTE.lash), clamp((1 - lid) * 2 - 0.6, 0, 1) * 0.5 * lw);
    }

    if (M.crease === 'band') {
      const crB = bulge(cr, 3.4 * px, { pin: true });
      push('crease' + k, HEAD, band(cr, crB, 0.8), solid(PALETTE.crease));
    }

    // --- brow: a soft tapered arch peaking at the outer third ---------------
    // A CENTRE LINE plus a half-thickness, so `brow.weight` thickens the brow
    // about its own axis and does not move its length, its tilt or where it
    // sits: inner station centre +3 half 9, middle station centre -0.5 half
    // 10.5. The outer tip and the inner cap lie ON the centre line and do not
    // scale at all — which is what keeps a heavy brow a brow rather than a
    // rectangle, since the taper at both ends is the shape's whole character.
    // At weight 1 these are the six points that were hard-coded here.
    const bw = browWeight;
    const bI = L['bwI' + k], bM = L['bwM' + k], bO = L['bwO' + k];
    // The shape half of the three brow channels (BROW_SHAPE). Every term is a
    // product with a channel, so every one of them is EXACTLY zero at rest and
    // the six points above are the six points that were here.
    const B = BROW_SHAPE;
    // `u` is -1 at the inner end and +1 at the outer, measured about the middle
    // station in the face's own direction, which is what makes `tilt` a
    // rotation rather than a shear that also moves the head of the brow.
    const half = Math.max(1, Math.abs(bO[0] - bI[0]) / 2);
    const tilt = (x) => e.browAngle * B.tilt * px * (((x - bM[0]) * s) / half);
    const archM = e.browRaise * B.arch * px;
    const archI = e.browRaise * B.archIn * px;
    const tipI = e.browInner * B.tip * px;
    const tipC = e.browInner * B.cap * px;
    const pinch = e.browInner * B.pinch * px;
    const tI = tilt(bI[0]), tM = tilt(bM[0]), tO = tilt(bO[0]);
    const browPts = [
      [bI[0] - s * 2 * px - s * pinch, bI[1] + 3 * px - 9 * px * bw - tI - tipI + archI],
      [bM[0], bM[1] - 0.5 * px - 10.5 * px * bw - tM - archM],
      [bO[0] + s * 11 * px, bO[1] + 3 * px - tO],
      [bM[0], bM[1] - 0.5 * px + 10.5 * px * bw - tM - archM],
      [bI[0] - s * 2 * px - s * pinch, bI[1] + 3 * px + 9 * px * bw - tI - tipI + archI],
      // cap: rounds the inner head of the brow — and carries `browInner`'s
      // rotation, being the point furthest from the pivot.
      [bI[0] - s * 9 * px - s * pinch, bI[1] + 3 * px - tI - tipC + archI],
    ];
    push('brow' + k, HEAD, spline(browPts, 0.9), solid(side < 0 ? PALETTE.brow : PALETTE.browR));
    if (pen && pen.brow) {
      push('browInk' + k, HEAD, spline(browPts, 0.9), INK, 1, { stroke: nib(pen.brow) });
    }

    return out;
  }

  return { rest: eyeChannelRest(), draws };
}
