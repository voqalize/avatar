// ---------------------------------------------------------------------------
// author/parts/mouth.mjs — the round idiom's mouth, as a PART, in CHANNEL SPACE.
//
// A PART is one feature of a face — a mouth, an eye — packaged so that the
// avatar's build.mjs no longer holds its geometry. It has two APIs, and the
// split between them is the whole idea:
//
//   CONSTRUCTION (build time, once per persona)
//     makeMouth({ P, PALETTE, solid, group }) -> part
//     Everything that is a constant of THIS character: proportions, the
//     resolved palette, the persona's paint registry, the group tag. A second
//     persona is a second `makeMouth` with a second palette; they never share.
//
//   DRIVING (once per control vector, so once per pose)
//     part.draws(c, L, env) -> [ { slot, group, cmds, paint, a, ...extra }, ... ]
//     An ORDERED array — draw order IS paint order and the part owns it. `c` is
//     the control vector, `L` the landmarks the avatar solved for that vector,
//     `env` anything else a caller needs to hand in (nothing, for this mouth).
//
//   REST BLOCKS
//     mouthRestChannels() -> the `mouth:` sub-object THIS part implements.
//     mouthRest()         -> the LEGACY nine-key block, kept because
//                            `REST_CONTROLS` is shared with two avatars whose
//                            mouths are still inline (see below).
//
// The fixed-opcode rule (author/path.mjs) is the part's contract with the
// runtime: every shape here is emitted by a primitive whose opcode count
// depends on the point COUNT and never on the point VALUES, at a point count
// that is a literal. So a pose is a straight rebuild-and-diff (author/rig.mjs,
// `poseHarness`) and topology can never drift — which is why a part gets its
// poses for free and does not carry any of its own.
//
// ---------------------------------------------------------------------------
// THE DRIVER BLOCK (voqalize `PoseChannel`, the 10 mouth channels)
//
//   channel      rest   range      meaning (voqalize params.js / avatar.d.ts)
//   open         0.02   0..1       VISIBLE aperture height — the dark gap, not
//                                  the lip-centreline distance
//   width        0.42   0..1       corner-to-corner span
//   round        0.10   0..1       pucker: rounds AND narrows the aperture
//   press        0.15   0..1       lips thinned and pressed together
//   tuck         0.0    0..1       lower lip drawn under the upper teeth (F/V)
//   cornerL/R    0.0   -1.4..1.4   per-side corner lift, + = smile
//   teeth        0.0    0..1       upper-teeth reveal
//   tongue       0.0    0..1       tongue raised into the aperture
//   c.jaw        0.0    0..1       chin drop — TOP-LEVEL, not in this block,
//                                  because the avatar's own landmark solve
//                                  reads it (the whole jaw silhouette moves).
//                                  The mouth reads it too: the lower lip
//                                  follows the chin by JAW_FOLLOW of the drop.
//                                  voqalize derives it as jaw = 0.7 * open.
//
// PART-LOCAL EXTRAS — driver params with no counterpart in the contract, kept
// because a shape here needs them and documented as this part's own:
//   tongueUp   0..1  tongue POSITION, not amount: 0 behind the lower teeth,
//                    1 up at the upper lip. voqalize has one scalar `tongue`,
//                    so the `th` viseme (the tongue between the teeth) has
//                    nowhere else to live. Lerped, never branched on, so it
//                    interpolates like everything else.
//   c.lipFull  an IDENTITY morph (`morph/lips_±100`), not a performance
//                    channel; it stays on the control vector.
//
// WHAT `upRaise` AND `cornerY` BECAME. `upRaise` (px, raised the upper lip's
// inner edge) is gone into `press`, which thins BOTH lips, flattens the bow and
// straightens the seam — a shape change rather than a translation, because
// A-vs-X has to be topological (see the fidelity note). `cornerY` (one px
// value, + = down, both corners) split into `cornerL`/`cornerR` in the
// contract's own sign and units (+ = smile = up), which is what finally lets
// this face smirk.
//
// THE LEGACY BLOCK. `author/rig.mjs`'s `REST_CONTROLS` is shared by all three
// avatars, and `avatars/{facet,ink}/build.mjs` still hold their mouths inline
// against the OLD nine keys (`m.w`, `m.open` in px, `m.protrude`, …). So
// `mouthRest()` still returns those, `REST_CONTROLS` is untouched, and the one
// avatar that has adopted the part composes its own vector:
//
//     const ctrl = makeCtrl({ ...REST_CONTROLS, mouth: mouthRestChannels() });
//
// When ink grows `mouth-ink.mjs` it does the same and `mouthRest()` goes.
//
// ---------------------------------------------------------------------------
// FIDELITY — where the numbers below come from
//
// `parts/ref/mouth/v2-high.png` is nine drawn Rhubarb visemes; its
// `.measure.json` is those drawings as numbers, normalised by each cell's own
// corner span. `MAP` is fitted to them (`parts/README.md` for the schema,
// avatars/round/NOTES.md for the residuals). What the sheet taught, in order
// of how much geometry it moved:
//
//  * The inner opening is NOT the corner-to-corner gap. It is its own pair of
//    arcs, inset from the corners by an amount that is mostly a function of
//    `round` — 0.73 of the mouth's width at B, 0.95 at D, 0.12 at F. The old
//    mouth ran its lip edges corner to corner, so every open viseme showed an
//    aperture the full width of the mouth and F could not pucker at all.
//  * The upper lip has a cupid's bow with two peaks and a philtrum dip about
//    13% of the lip's thickness deep, tapering to nothing at the corners; the
//    lower lip is ~15% thicker than the upper at rest and stays fuller as the
//    mouth opens (the sheet's `lip_th_ratio` is 0.86 at X and 0.70 at D).
//  * Both lips thin as the mouth opens (foreshortening) and thicken under
//    `round` (the pucker bunches them).
//  * The teeth are a row of roughly CONSTANT height — `teeth_reveal` is 0.95 at
//    B and 0.08 at D not because the row grows but because the hole does.
//
// And three things the sheet could not tell us, authored by hand from the
// channel semantics instead:
//  * G is a second B in the drawing (the model will not draw F/V), so G is
//    authored from the tuck: the lower lip rides up under the teeth, the row
//    overlaps it, and there is no dark gap left at all.
//  * A and X are one drawing. They differ here by `press` alone: thinner lips,
//    a flatter bow, a straighter seam and a slightly narrower mouth.
//  * The sheet's mouth WIDTH was pinned by the prompt, so width comes from the
//    channel (voqalize's own `26 + 32·width`, normalised), not from the sheet.
// ---------------------------------------------------------------------------

import { eqp, polygon, spline, openSpline, arc, circle, shift, band, bulge, contours } from '../path.mjs';
import { clamp, lerp, drawPusher } from '../rig.mjs';

// The `mouth:` block of the control vector, at rest — voqalize's REST, verbatim,
// plus this part's one extra. Sixteen visemes and nine Rhubarb letters are
// patches on these ten numbers and nothing else.
export function mouthRestChannels() {
  return {
    open: 0.02, width: 0.42, round: 0.10, press: 0.15, tuck: 0,
    cornerL: 0, cornerR: 0, teeth: 0, tongue: 0,
    tongueUp: 0,
  };
}

// The pre-channel block. Only `author/rig.mjs`'s REST_CONTROLS calls this, and
// only because facet and ink still read those keys out of it. See the header.
export function mouthRest() {
  return {
    w: 1, open: 0, cornerY: 0, upRaise: 0, protrude: 0,
    teeth: 0, tongue: 0, tongueUp: 0, lowTuck: 0,
  };
}

// ---------------------------------------------------------------------------
// THE FRONT DOOR: channel units -> design-space pixels.
//
// Every number that converts a 0..1 channel into a distance on this
// character's face is here and nowhere else. The ones marked FIT were chosen
// by least squares against the reference sheet (`parts/fit-mouth.mjs`); the
// rest are style, and say so.
// ---------------------------------------------------------------------------
export const MAP = {
  // --- corner span ---------------------------------------------------------
  // voqalize's own width law (`w = 26 + 32·mouthWidth`, face-peep.js),
  // normalised so that width = 0.42 is exactly this character's `P.mouthHalfW`.
  // STYLE: the sheet pinned its corners, so it has nothing to say here.
  WIDTH_A: 0.659, WIDTH_B: 0.811,
  // voqalize's peep pulls the corners in by 0.36 per unit of round. The sheet
  // disagrees and it can be checked: its F is the most puckered mouth in the
  // set and still 0.84 of X's width. At 0.36 this face's F was 0.50 of rest,
  // and a lower lip 21 units thick inside a 96-unit mouth stopped reading as a
  // lip and started reading as a kite. FIT to `width_vs_rest`, F and E.
  ROUND_NARROW: 0.18,      // pucker pulls the corners in
  PRESS_NARROW: 0.30,      // pressed lips are a little narrower

  // --- the aperture --------------------------------------------------------
  // FIT says 147.4 — the sheet's D is 0.688 of its own corner span. STYLE CAP
  // at 105: this face has 190 design units between the nose base and the chin,
  // and a 125-unit hole put the mouth interior on the jawline. A deliberate
  // -29% deviation from the sheet, and the largest one here.
  APER_PX: 105,            // visible aperture height at open = 1
  AH_ROUND: 0.565,         // FIT: a pucker closes the hole vertically too
  APER_UP: 0.34,           // STYLE: share of it that opens UPWARD. The rest
                           // goes down, and the jaw takes the corners with it.
  APER_POW: 0.80,          // STYLE: <1 fattens the lens toward a rectangle
  // aperture WIDTH, in units of the REST corner span. FIT.
  AW_0: 0.685, AW_W: 0.296, AW_O: 0.138, AW_ROUND: 0.909,
  AW_MAX: 0.94,            // never wider than this share of the corner span

  // --- corners -------------------------------------------------------------
  // STYLE: peep travels 0.61 of its half-span per unit of corner. This face
  // carries its corners only 10 units above the opening, and 0.61 put a smile
  // in the cheek; 0.33 keeps a +0.3 smile at the 9 px the old `cornerY` used.
  CORNER_PX: 32,
  CORNER_MID: 0.5,         // how much of the corner lift the centre follows

  // --- lip mass ------------------------------------------------------------
  // FIT says 0.587 / 0.504 — the sheet's D keeps 0.59 of its upper lip and 0.73
  // of its lower. STYLE CAP at 0.35 / 0.30: the sheet's lips are twice this
  // character's to begin with (0.166 of the corner span against round's 15/192
  // = 0.078), so the same RATIO leaves a 6 px rim where the sheet still has a
  // lip. Faithful to the sheet's ratio, this face's D reads as a hole in a chin.
  TH_OPEN_U: 0.35, TH_OPEN_L: 0.30,    // lips thin as the mouth opens
  TH_POW: 0.5,                         // FIT: …fast at first, then flattening
  TH_ROUND_U: 0.084, TH_ROUND_L: 0.046, // FIT: the pucker bunches them
  PRESS_THIN: 0.70,        // STYLE: the sheet drew A as X, so press is ours
  PRESS_STRAIGHT: 1.9,     // STYLE: press pulls the seam onto the corner chord
  PRESS_BOW: 0.9,          // STYLE: press flattens the cupid's bow
  BOW: 0.14,               // FIT: bow depth as a share of upper-lip thickness
  ROUND_RING: 0.85,        // STYLE: how far a full pucker pushes the lips' mass
  RING_X: [-1, -0.87, -0.42, 0, 0.42, 0.87, 1],  // ...out toward these stations
  LIPFULL_U: 0.55, LIPFULL_L: 0.60,    // the identity morph, unchanged

  // --- teeth, tongue, tuck -------------------------------------------------
  TEETH_PX: 24.7,          // FIT: height of the upper row at teeth = 1
  TEETH_W: 0.82,           // its width, as a share of the aperture's
  TEETH_FILL: 0.82,        // how much of a closed-ish aperture it may fill
  TUCK_RISE: 0.85, TUCK_MIN: 6,   // lower aperture edge rides up under tuck
  TUCK_OVER: 28,           // …and the teeth row is allowed that far past it
  TUCK_THIN: 0.50,         // the tucked lower lip is rolled in, so thinner
  TONGUE_RISE: 0.78,       // how far up the aperture the tongue comes at 1
  TONGUE_W: 0.72,          // its width, as a share of the aperture's
  // The tongue is drawn BEHIND the lips but it is not CLIPPED by them, so its
  // ellipse has to be bounded by the aperture and not by the aperture's height:
  // sized off `(dUp+dLo)` alone, D's disc hung ~90 px below a lower lip only 11
  // px thick and read as a pink chin. It may reach this far past the lower arc
  // and no further, which is just enough for the lip to cover the seam.
  TONGUE_BOT_PAD: 2,
  // …and its opacity floor: at `tongue` .15 (Rhubarb D) a visible tongue is a
  // second lip, so the ramp starts at .10 and still saturates by .56 (H is .9).
  TONGUE_A0: 0.10, TONGUE_AK: 2.2,

  // --- the jaw -------------------------------------------------------------
  JAW_FOLLOW: 0.24,        // share of P.jawDrop the lower lip takes with it
  SEAM_FADE: [14, 10],     // the seam is gone this many px of aperture later

  // --- expression: what `cornerL/R` and `press` do BESIDES moving a corner --
  // The corner channels are the mixer's only mouth-side expression, and a
  // corner that only translates reads as a mouth with a hinge. A real smile is
  // a composite: the corners go up AND out, the lip line CURVES between them
  // (flat through the middle, turning at the ends), the upper lip stretches
  // thin over it, the lower lip rolls full, and the commissure pocket deepens.
  // A frown is not that composite reversed — the lower lip presses IN, the
  // corners draw slightly inward, and the pocket sharpens instead of deepening.
  // Every one of these is written so it is EXACTLY 1 (or 0) at cornerL/R = 0:
  // `mouthRestChannels()` still renders this character's rest pose to the byte.
  SMILE_OUT: 0.085,        // corners travel outward, per unit of +corner
  FROWN_IN: 0.055,         // …and inward on a frown
  SMILE_MID: 0.40,         // the centre follows the corners LESS the harder
                           // they pull — which is where the curvature comes from
  SEAM_FLAT: 0.50,         // …and the lip line flattens in the middle as it does
  SMILE_BOWFLAT: 0.55,     // the cupid's bow flattens as the upper lip stretches
  SMILE_THIN_U: 0.22,      // …and the upper lip thins with it
  SMILE_FULL_L: 0.16,      // the lower lip rolls full
  SMILE_LO_BOW: 0.9,       // …and rounder: its profile stations bow out
  FROWN_THIN_L: 0.22,      // a frown presses the lower lip in and thin
  CM_R: 0.50,              // the commissure pocket deepens with a smile
  CM_WIDE: 0.22,           // …and flattens, being stretched between the lips
  CM_SHARP: 0.35,          // a frown makes it smaller
  CM_ASP: 0.45,            // …and taller: a pinch rather than a pocket
  CM_DX: 0.55,             // both ride further into the corner
  SMILE_SEAM: 0.55,        // a smile is READ off the line between the lips, so
                           // that line thickens as the corners travel: at this
                           // size the corner displacement is already 1.7x
                           // peep's and the thing peep beats us on is CONTRAST
                           // — a 4.5-unit ribbon under a pink lip against a
                           // 6-unit black stroke on white.
  PRESS_SEAM: 0.85,        // press above REST widens the seam into a line
  PRESS_IN: 0.07,          // …and draws the corners in
};

// The rest normalisers. Every law above is written in the contract's units and
// then divided by its own value at REST, so `mouthRestChannels()` reproduces
// this character's proportions exactly whatever the constants are — which is
// what lets the fit move them without moving the rest pose.
const R = mouthRestChannels();
const widthFactor = (width, round, press) =>
  (MAP.WIDTH_A + MAP.WIDTH_B * width) * (1 - MAP.ROUND_NARROW * round) * (1 - MAP.PRESS_NARROW * press);
const upFactor = (open, round, press) =>
  (1 - MAP.TH_OPEN_U * Math.pow(open, MAP.TH_POW)) * (1 + MAP.TH_ROUND_U * round) * (1 - MAP.PRESS_THIN * press);
const loFactor = (open, round, press) =>
  (1 - MAP.TH_OPEN_L * Math.pow(open, MAP.TH_POW)) * (1 + MAP.TH_ROUND_L * round) * (1 - MAP.PRESS_THIN * press);
const REST_W = () => widthFactor(R.width, R.round, R.press);
const REST_U = () => upFactor(R.open, R.round, R.press);
const REST_L = () => loFactor(R.open, R.round, R.press);

// ---------------------------------------------------------------------------
// THE FRAME: one control vector's worth of mouth, as numbers and point runs.
// `draws` paints it and `mouthMetrics` measures it, so what the fit measures
// is exactly what the rig draws.
//
// P keys read: mouthHalfW, lipUpTh, lipLowTh, jawDrop.
// L keys read: mcorL, mcorR, mth_c.
// c keys read: mouth.*, jaw, lipFull.
// ---------------------------------------------------------------------------
export function mouthFrame(P, c, L) {
  const m = c.mouth;
  const open = clamp(m.open, 0, 1), width = clamp(m.width, 0, 1);
  const round = clamp(m.round, 0, 1), press = clamp(m.press, 0, 1);
  const tuck = clamp(m.tuck, 0, 1), teeth = clamp(m.teeth, 0, 1);
  const tongue = clamp(m.tongue, 0, 1);
  const cL = clamp(m.cornerL, -1.4, 1.4), cR = clamp(m.cornerR, -1.4, 1.4);
  const jaw = clamp(c.jaw, 0, 1);

  const ml = L.mcorL, mr = L.mcorR;
  const mcx = (ml[0] + mr[0]) / 2;
  const restHW = (mr[0] - ml[0]) / 2;
  const hw = restHW * (widthFactor(width, round, press) / REST_W());

  // --- the expression axis, split into the four numbers the shape wants ----
  // Per side for everything that has a side (the asymmetry is the smirk), and
  // averaged for everything the whole lip line shares. `pAbs` is press ABOVE
  // its rest value, so a pressed mouth is a DEPARTURE from this face rather
  // than a state this face is already in.
  const cPosL = Math.max(0, cL), cPosR = Math.max(0, cR);
  const cNegL = Math.max(0, -cL), cNegR = Math.max(0, -cR);
  const cAvg = (cL + cR) / 2;
  const cPos = Math.max(0, cAvg), cNeg = Math.max(0, -cAvg), cMag = Math.abs(cAvg);
  const pAbs = Math.max(0, press - R.press);

  // The corner span, now per side: a smile widens the mouth as it lifts, a
  // frown narrows it, and a press draws both corners in. Each factor is
  // exactly 1 at rest, so `hwL === hwR === hw` there.
  const hwL = hw * (1 + MAP.SMILE_OUT * cPosL - MAP.FROWN_IN * cNegL - MAP.PRESS_IN * pAbs);
  const hwR = hw * (1 + MAP.SMILE_OUT * cPosR - MAP.FROWN_IN * cNegR - MAP.PRESS_IN * pAbs);
  // …so the normalised run coordinate is per side too.
  const fx = (x) => (x < mcx ? (x - mcx) / hwL : (x - mcx) / hwR);

  // Corners, one per side: + is a lift, and screen y grows downward.
  const cyL = ml[1] - cL * MAP.CORNER_PX;
  const cyR = mr[1] - cR * MAP.CORNER_PX;
  const chordMid = (cyL + cyR) / 2;
  const chord = (x) => chordMid + fx(x) * (cyR - cyL) / 2;

  // The closed-lip line. It runs corner to corner through a centre that sits
  // BELOW the corners — which is this character's resting smile — and `press`
  // pulls it back onto the straight chord between them.
  // The centre follows the corners only PART of the way, and the harder they
  // pull the less of it it follows: at CORNER_MID flat the whole lip line just
  // translates, which is the hinge. Backing the follow off with `cMag` is what
  // opens the curve — the corners are 32 px up and the centre 5, so the line
  // between them has to bend.
  const myc = L.mth_c[1] - cAvg * MAP.CORNER_PX * (MAP.CORNER_MID - MAP.SMILE_MID * cMag)
    + jaw * P.jawDrop * MAP.JAW_FOLLOW * 0.5;
  const seamMid = myc + (chordMid - myc) * MAP.PRESS_STRAIGHT * press;
  const dip = seamMid - chordMid;
  // …and the PROFILE of that bend changes with it. A parabola peaks at the
  // centre and is the shape a hinge makes; a smile is flat through the middle
  // and turns in the last third. `(1-f^2)^p` with p < 1 is exactly that, and
  // p = 1 is the parabola we had, to the bit.
  const seamFlat = MAP.SEAM_FLAT * cPos;
  const seamY = (x) => {
    const f = fx(x), q = Math.max(0, 1 - f * f);
    return chord(x) + dip * (seamFlat > 0 ? Math.pow(q, 1 - seamFlat) : q);
  };

  // The aperture. Its width is a law of its own — the sheet's whole point.
  const awRel = (MAP.AW_0 + MAP.AW_W * width + MAP.AW_O * open) * (1 - MAP.AW_ROUND * round);
  const ahw = Math.max(2, Math.min(P.mouthHalfW * awRel, hw * MAP.AW_MAX));
  const h = MAP.APER_PX * open * (1 - MAP.AH_ROUND * round);
  const dUp = h * MAP.APER_UP;
  // Tuck pulls the lower edge up under the teeth, and may take it past the
  // upper one — a tucked lip leaves no dark gap at all, which is the whole
  // difference between G and B.
  const dLo = Math.max(2 - dUp, h * (1 - MAP.APER_UP) - tuck * (h * MAP.TUCK_RISE + MAP.TUCK_MIN))
    + jaw * P.jawDrop * MAP.JAW_FOLLOW * 0.5;

  // The lens profile: 1 at the centre, 0 at ±ahw, fattened by APER_POW.
  const lens = (x) => {
    const f = clamp((x - mcx) / ahw, -1, 1);
    return Math.pow(Math.max(0, 1 - f * f), MAP.APER_POW);
  };
  const innerUp = (x) => seamY(x) - dUp * lens(x);
  const innerLo = (x) => seamY(x) + dLo * lens(x);

  // The nine x stations every corner-to-corner run is sampled at: the corner,
  // the midpoint of the closed run, the aperture's own five, and back. A
  // literal count, at every control value, which is the fixed-opcode rule.
  const XS = [-1, -0.5, 0, 0.5, 1].map((f) => mcx + f * ahw);
  const RUN = [mcx - hwL, mcx - (hwL + ahw) / 2, ...XS, mcx + (hwR + ahw) / 2, mcx + hwR];
  const upperInner = RUN.map((x) => [x, innerUp(x)]);
  const lowerInner = RUN.map((x) => [x, innerLo(x)]);
  const apUpper = XS.map((x) => [x, innerUp(x)]);
  const apLower = XS.map((x) => [x, innerLo(x)]);

  // Lip mass. Thickness is measured at the centre line, exactly as the sheet
  // measures it, and both lips ride on the aperture's arcs.
  // A smile STRETCHES the upper lip over the teeth (thinner) and rolls the
  // lower one out (fuller); a frown presses the lower lip in against them.
  const thUp = P.lipUpTh * (1 + MAP.LIPFULL_U * c.lipFull)
    * (upFactor(open, round, press) / REST_U()) * (1 - MAP.SMILE_THIN_U * cPos);
  const thLo = P.lipLowTh * (1 + MAP.LIPFULL_L * c.lipFull)
    * (loFactor(open, round, press) / REST_L()) * (1 - MAP.TUCK_THIN * tuck)
    * (1 + MAP.SMILE_FULL_L * cPos - MAP.FROWN_THIN_L * cNeg);

  // The cupid's bow: two peaks BOW deeper than the philtrum dip, tapering to
  // nothing at the corners. `press` flattens it toward a plain arc.
  const bowAmp = MAP.BOW * (1 - MAP.PRESS_BOW * press) * (1 - MAP.SMILE_BOWFLAT * cPos);

  // A pucker is not just a narrow mouth: the lips BUNCH, so their mass sits out
  // near the commissures instead of tapering away from the centre. Without this
  // the sheet's F comes out a WEDGE — a flat bar over a V — because a 20 px lip
  // hung on a 60 px half-width has no room to arc, and a wedge does not read as
  // lips at 1x. `ring` slides the profile STATIONS outward as `round` climbs, so
  // the mass rounds out while both ends still close to a point at the corner —
  // raising the corner FACTOR instead grows fins there, which is worse. It moves
  // x only, never the centre-line thickness the sheet measures, so the fit is
  // untouched.
  const ring = MAP.ROUND_RING * round;
  const stations = (xs) => xs.map((f, i) =>
    mcx + (f + (MAP.RING_X[i] - f) * ring) * (i < 3 ? hwL : i > 3 ? hwR : hw));

  const UP_F = [0, 0.74, 1 + bowAmp, 1, 1 + bowAmp, 0.74, 0];
  const UP_X = stations([-1, -0.62, -0.23, 0, 0.23, 0.62, 1]);
  const upperOuter = UP_X.map((x, i) => [x, innerUp(x) - thUp * UP_F[i]]);

  // …and the lower lip's own profile rounds out with the smile, which is the
  // difference between a full lip and a thicker one.
  const loB = clamp(MAP.SMILE_LO_BOW * cPos, 0, 1);
  const LO_F = [0, 0.62 + 0.16 * loB, 0.94 + 0.05 * loB, 1, 0.94 + 0.05 * loB, 0.62 + 0.16 * loB, 0];
  const LO_X = stations([-1, -0.62, -0.28, 0, 0.28, 0.62, 1]);
  const lowerOuter = LO_X.map((x, i) => [x, innerLo(x) + thLo * LO_F[i]]);

  // The teeth row: a near-constant height hanging off the upper arc. What
  // changes with the viseme is the hole it hangs in, not the row.
  const tw = ahw * MAP.TEETH_W;
  const tH = Math.min(MAP.TEETH_PX * teeth,
    Math.max(3, (dUp + dLo) * MAP.TEETH_FILL + tuck * MAP.TUCK_OVER));
  const TX = [-1, -0.55, 0, 0.55, 1].map((f) => mcx + f * tw);
  const teethTop = TX.map((x) => [x, innerUp(x) + 1.5]);
  const teethBot = TX.map((x, i) => [x, innerUp(x) + 1.5 + tH * [0.25, 0.88, 1, 0.88, 0.25][i]]);

  // The tongue: one rounded mass, rising out of the lower arc — or up at the
  // upper lip when `tongueUp` says so (the `th` viseme).
  const tgLow = innerLo(mcx) - MAP.TONGUE_RISE * (dUp + dLo) * tongue;
  const tgUp = innerUp(mcx) + 6;
  const tgTop = lerp(tgLow, tgUp, clamp(m.tongueUp, 0, 1));
  const tgRx = Math.max(8, ahw * MAP.TONGUE_W);
  // Bounded by the hole, not by the hole's height: the natural radius is
  // `(dUp+dLo)·0.55 + 8`, but the ellipse's BOTTOM is then pinned to the lower
  // arc (plus TONGUE_BOT_PAD) whenever that is nearer, so no viseme can hang a
  // pink disc below the lower lip.
  const tgBot = innerLo(mcx) + MAP.TONGUE_BOT_PAD;
  const tgRy = Math.max(6,
    (Math.min(tgBot, tgTop + 2 * ((dUp + dLo) * 0.55 + 8)) - tgTop) / 2);

  return {
    m, open, width, round, press, tuck, teeth, tongue, jaw,
    mcx, hw, hwL, hwR, ahw, h, dUp, dLo, cyL, cyR, seamY, restHW,
    cPosL, cPosR, cNegL, cNegR, pAbs,
    upperInner, lowerInner, apUpper, apLower, upperOuter, lowerOuter,
    thUp, thLo, tw, tH, teethTop, teethBot, tgTop, tgRx, tgRy,
    cornerL: [mcx - hwL, cyL], cornerR: [mcx + hwR, cyR],
  };
}

// The sheet's own measurements, taken off the frame instead of off a drawing.
// Lengths are in units of the REST corner span (`2 · P.mouthHalfW`), which is
// what makes them comparable with the sheet's numbers once those are
// un-normalised by each cell's `width_vs_rest` — the sheet's per-cell width is
// framing discipline, not anatomy (parts/README.md).
export function mouthMetrics(P, F) {
  const W = 2 * P.mouthHalfW;
  const area = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      a += x0 * y1 - x1 * y0;
    }
    return Math.abs(a) / 2;
  };
  const apRing = [...F.apUpper, ...F.apLower.slice().reverse()];
  const apArea = area(apRing);
  const teethRing = [...F.teethTop, ...F.teethBot.slice().reverse()];
  // The row is clipped by the hole it hangs in, so what shows is the overlap.
  const shown = Math.min(area(teethRing), apArea + F.tuck * area(teethRing));
  const oh = F.dUp + F.dLo, ow = 2 * F.ahw;
  return {
    open_h: oh / W,
    open_w: oh > 3 ? ow / W : 0,
    round_ratio: oh > 3 && ow > 0 ? oh / ow : 0,
    upper_lip_th: F.thUp / W,
    lower_lip_th: F.thLo / W,
    lip_th_ratio: F.thUp / F.thLo,
    teeth_reveal: apArea > 1 ? clamp(shown / apArea, 0, 1) : 0,
    corner_span: 2 * F.hw / W,
  };
}


// ---------------------------------------------------------------------------
// The mouth has the same two idioms the eye does (parts/README.md § Two idioms):
// a flat-fill face models with shapes, an outlined one models with shapes AND a
// pen over them. `pen` is the whole of the second idiom — omit it and nothing
// below changes — and `marks` turns the individual features on and off.
//
//   pen   { paint, lip, aper, sep, cap, join }   null = no outline anywhere
//           `lip`  the outer lip contour, one closed ring over both fills
//           `aper` the inner lip line round the aperture, alpha-ramped with
//                  `open` because a stroke width is not a pose channel
//           `sep`  the tooth separators, drawn as strokes instead of quads
//   marks { bow, gum, lipHiFade, lipHiAlpha, bowAlpha, lipCastAlpha,
//           toothSep, toothSepA, toothSh, seam, seamAlpha, commiss,
//           commissAlpha }
// ---------------------------------------------------------------------------

/** Which of the mouth's marks exist, and at what strength. */
export const MOUTH_MARKS = {
  bow: true,                  // the cupid's-bow highlight over the upper lip
  gum: false,                 // a gum arc over the top of the teeth row
  lipHiFade: 0,               // how much `round` fades the lower-lip highlight
  lipHiAlpha: 1,              // material strength; geometry and timing stay fixed
  bowAlpha: 1,
  lipCastAlpha: 0,            // a soft lower-lip shadow, disabled for legacy rigs
  toothSep: [-0.36, 0.05, 0.42],  // separator stations, in units of the row's half-width
  toothSepA: 0.9,             // …and their share of the row's alpha
  toothSh: { depth: 5, a: 0.55, blend: 'multiply' },   // the upper lip's cast shadow
  seam: [-1.5, 3.0],          // the seam ribbon's two offsets off its own run
  seamAlpha: 1,
  commiss: { r: 0.028, dx: 0.030, blend: 'multiply' }, // the corner pockets
  commissAlpha: 1,
  philtrum: null,             // an optional quiet two-plane neutral-mouth cue
};

export function makeMouth({ P, PALETTE, solid, group = 'head', marks = {}, pen = null }) {
  const HEAD = group;
  const M = { ...MOUTH_MARKS, ...marks };
  const nib = (w) => ({ w, cap: (pen && pen.cap) || 'round', join: (pen && pen.join) || 'round' });
  const INK = pen ? solid(pen.paint) : null;

  // PALETTE keys read: mouthIn, teeth, toothSep, toothSh, tongue, lipLow,
  //                    lipHi, lipUp, lipBow, lipCast, seam, commiss, philtrum.
  function draws(c, L, env = {}) {
    const out = [];
    const push = drawPusher(out);
    const F = mouthFrame(P, c, L);
    const { mcx, ahw, tw } = F;

    // ---- the hole ----------------------------------------------------------
    // Its own two arcs now, not a diamond between the corners: the lips close
    // over it OUTSIDE ±ahw, so the aperture's width is a channel and not an
    // accident of where the corners are.
    push('mouthIn', HEAD, spline([
      ...F.apUpper, ...F.apLower.slice().reverse().slice(1, -1),
    ], 0.8), solid(PALETTE.mouthIn));

    // ---- the tongue, behind the teeth and behind the lower lip -------------
    push('tongue', HEAD, spline(circle(mcx, F.tgTop + F.tgRy, F.tgRx, 8, F.tgRy / F.tgRx), 1),
      solid(PALETTE.tongue), clamp((F.tongue - MAP.TONGUE_A0) * MAP.TONGUE_AK, 0, 1));

    // A broad, quiet cast shadow makes the lower lip belong to the muzzle
    // rather than float as a coloured symbol. It follows the live lower-lip
    // curve, so speech keeps the same topology, closure and timing.
    if (M.lipCastAlpha > 0) {
      const castTop = F.lowerOuter.slice(1, 6).map(([x, y]) => [x, y + 3]);
      push('lipCast', HEAD, band(
        castTop,
        bulge(castTop, 8, { floor: 2, power: 0.8, pin: true }),
        0.86,
      ), solid(PALETTE.lipCast), M.lipCastAlpha);
    }

    // ---- the lower lip -----------------------------------------------------
    // Fuller than the upper, and it rides on the aperture's lower arc, so it
    // travels with every viseme without a number of its own.
    push('lipLow', HEAD, spline([
      ...F.lowerOuter, ...F.lowerInner.slice().reverse().slice(1, -1),
    ], 0.9), solid(PALETTE.lipLow));

    // The lower lip carries the brightest value in a portrait: it is the one
    // surface here that tilts up into the light. ~34% of the mouth's width,
    // centred, sitting between the lip's inner and outer edges so it travels
    // with every viseme.
    const loIn0 = F.lowerInner[4][1], loOut0 = F.lowerOuter[3][1];
    const hiY = loIn0 + (loOut0 - loIn0) * 0.50;
    const hiRx = F.hw * 0.34, hiRy = Math.max(2, (loOut0 - loIn0) * 0.26);
    // A rounded viseme both NARROWS the mouth and thickens the lip, which turns
    // a 2:1 highlight band into a disc floating in a tall keyhole — the pink
    // pill an outlined face's `viseme/U` was reviewed for. `lipHiFade` takes it
    // out as the mouth rounds, which is also the physics: a specular lives on a
    // lip pointing AT the light, and a protruded one does not.
    push('lipHi', HEAD, spline(circle(mcx, hiY, hiRx, 7, hiRy / hiRx), 1), solid(PALETTE.lipHi),
      M.lipHiAlpha * clamp(1 - M.lipHiFade * F.round, 0, 1));

    // ---- teeth: ONE band, never individual teeth ---------------------------
    // Painted AFTER the lower lip and BEFORE the upper one, which is the whole
    // of the F/V tuck: at tuck = 1 the row is allowed past the aperture's lower
    // edge and lands ON the lower lip, so G shows teeth resting on a lip and B
    // shows teeth over a dark sliver. Two topologies, not two amplitudes.
    // Reaching full opacity by teeth = 0.4 matters: at 0.8 over the near-black
    // mouth interior the band renders grey and the smile reads as a grimace.
    // …and the row all but goes out when the tongue is UP against it: `108 - L`
    // and `116 - th` are the same channels except for `tongueUp`, and with a
    // full-strength band in front of it the raised tongue is invisible, so the
    // two visemes were one drawing. The tongue is BEHIND the teeth in the paint
    // order and stays there; what changes is how much of the band is left.
    const tA = clamp(F.teeth * 2.6, 0, 1) * (1 - 0.75 * clamp(F.m.tongueUp, 0, 1));
    push('teeth', HEAD, band(F.teethTop, F.teethBot, 1), solid(PALETTE.teeth), tA);

    // The gum arc, for a style that wants one. It rides the row's own top edge
    // and is deliberately a hair OUTSIDE it — an inner edge leaves a 1-2 unit
    // rim of bare enamel tracing the top of the band and the inner upper lip,
    // the brightest, sharpest mark in the mouth, and the whole of why a white
    // row reads as a glow at 1x. Deeper than the cast shadow below, or it reads
    // as grey rather than as gum.
    if (M.gum) {
      const gTop = shift(F.teethTop, -1.2);
      push('gum', HEAD, band(gTop, gTop.map(([x, y]) => [x, y + 1.2 + F.tH * 0.34]), 1),
        solid(PALETTE.gum), tA);
    }

    // Three separators, spaced non-uniformly so the band does not read as a
    // barcode, and stopping short of the lower edge. One draw, three contours,
    // and `polygon` rather than a near-straight spline: each is a 3px-wide quad
    // that is ~2 device px at 1x, so four beziers per corner bought nothing but
    // 57 opcodes in every one of the 21 mouth poses.
    const sepRun = (f) => {
      const x = mcx + tw * f;
      const y0 = F.seamY(x) - F.dUp * Math.pow(Math.max(0, 1 - ((x - mcx) / ahw) ** 2), MAP.APER_POW) + 3;
      return [x, y0, y0 + F.tH * 0.88];
    };
    if (pen && pen.sep) {
      // An outlined face draws its gaps with the same pen as everything else;
      // three ticks, mid-point included so the run is a fixed 3 points.
      push('toothSep', HEAD, contours(
        ...M.toothSep.map((f) => {
          const [x, y0, y1] = sepRun(f);
          return openSpline([[x, y0], [x, (y0 + y1) / 2], [x, y1]], 0.9);
        }),
      ), INK, tA * M.toothSepA, { stroke: nib(pen.sep) });
    } else {
      push('toothSep', HEAD, contours(
        ...M.toothSep.map((f) => {
          const [x, y0, y1] = sepRun(f);
          return polygon([[x - 1.6, y0], [x + 1.6, y0], [x + 1.3, y1], [x - 1.3, y1]]);
        }),
      ), solid(PALETTE.toothSep), tA * M.toothSepA);
    }

    // The upper lip's cast shadow across the top of the band, doing the gum
    // line's job too (see PALETTE.toothSh).
    push('toothSh', HEAD, band(F.teethTop, F.teethTop.map(([x, y]) => [x, y + M.toothSh.depth]), 1),
      solid(PALETTE.toothSh), tA * M.toothSh.a,
      M.toothSh.blend ? { blend: M.toothSh.blend } : undefined);

    // ---- the upper lip, with a bow ----------------------------------------
    push('lipUp', HEAD, spline([
      ...F.upperOuter, ...F.upperInner.slice().reverse().slice(1, -1),
    ], 0.85), solid(PALETTE.lipUp));

    // cupid's bow: the ridge over the two peaks, as a highlight rather than a
    // line. The dip at the centre is already in `upperOuter`.
    if (M.bow) {
      const bowTop = F.upperOuter.slice(1, 6);
      push('lipBow', HEAD, band(bowTop, bowTop.map(([x, y]) => [x, y + 4.5]), 1),
        solid(PALETTE.lipBow), M.bowAlpha);
    }

    // The philtrum is not a pair of drawn-on lines. It is two very shallow
    // planes that narrow into the cupid's-bow dip: enough material change to
    // connect nose and mouth in a neutral listening frame, quiet enough to
    // disappear into every speech shape. `L.philt` is face-space while the
    // lower endpoint comes from this frame's live upper lip, so the cue never
    // hangs across an opened or smiling mouth.
    if (M.philtrum) {
      const { a = 0.5, w = 14 } = M.philtrum;
      const [px, py] = L.philt;
      const bottom = Math.max(py + 6, F.upperOuter[3][1] - 3);
      const plane = (side) => polygon([
        [px + side * w * 0.50, py], [px + side * w * 0.16, py + 2],
        [px + side * w * 0.22, bottom], [px + side * w * 0.52, bottom - 2],
      ]);
      push('philtrum', HEAD, contours(plane(-1), plane(1)), solid(PALETTE.philtrum), a);
    }

    // ---- the pen, over both fills -----------------------------------------
    // The outer lip contour: ONE closed ring round the whole mouth rather than
    // an outline per lip, so the two lips do not each get a line where they
    // meet — the seam below is what says that, tapered, and a pair of full-
    // weight strokes there is the "even-weight line running over the tapered
    // wedge" an outlined mouth gets reviewed for.
    if (pen && pen.lip) {
      push('lipInk', HEAD, spline([
        ...F.upperOuter, ...F.lowerOuter.slice().reverse().slice(1, -1),
      ], 0.85), INK, 1, { stroke: nib(pen.lip) });
    }

    // The inner lip line. It exists to run round an OPENING, and it is only
    // that once there is one: as the mouth shuts the ring's two sides walk into
    // each other and a round-capped stroke collapses into a blunt black lens
    // heavier than the silhouette. Width is not a pose channel, so alpha is the
    // only way to say "this line is not there" — off at a closed aperture, full
    // by APER_PX·0.55, crossfading against the seam's own fade-out.
    if (pen && pen.aper) {
      push('aperInk', HEAD, spline([
        ...F.apUpper, ...F.apLower.slice().reverse().slice(1, -1),
      ], 0.8), INK, clamp((F.dUp + F.dLo - 4) / (MAP.APER_PX * 0.55), 0, 1),
      { stroke: nib(pen.aper) });
    }

    // ---- the seam ----------------------------------------------------------
    // The line between the lips: thickest dead centre, tapering to nothing at
    // both corners. The taper is the whole point — a uniform line reads as a
    // cut. It fades out as the aperture opens, because past a few px of gap the
    // thing between the lips is the mouth, not a seam.
    // It also has a job the taper does not advertise: `lipUp`'s lower edge and
    // `lipLow`'s upper edge are two Catmull-Rom curves through nearly the same
    // points at different tensions, and they bow apart by a px or two either
    // side of centre, showing a hairline of FACE colour between the lips. The
    // seam straddles that hairline instead of sitting on it.
    // 4.5 units wide, biased downward (-1.5 / +3.0) so it sits mostly in the
    // shadow under the upper lip; `power` 0.9 makes the taper toward the
    // corners a real taper instead of a step up to full width in the first
    // tenth of the run.
    // `press` above REST widens the ribbon: a pressed mouth is a LINE, and the
    // thinning the press already does to both lips leaves nothing between them
    // to say so. Keyed on `press - REST.press` so this face at rest is not a
    // face already pressing its lips, and so the closed visemes (A at 0.55, G
    // at 0.40) get it too — which is the same shape for the same reason.
    const seamRun = arc(eqp(F.cornerL), [mcx, F.seamY(mcx) + 1], eqp(F.cornerR), 4);
    const seamAt = (dy) => bulge(seamRun, dy, { power: 0.9 });
    const [s0, s1] = MAP.SEAM_FADE;
    const seamW = 1 + MAP.PRESS_SEAM * F.pAbs + MAP.SMILE_SEAM * Math.max(0, (F.cPosL + F.cPosR) / 2);
    push('seam', HEAD, band(seamAt(M.seam[0] * seamW), seamAt(M.seam[1] * seamW), 0.9),
      solid(PALETTE.seam), M.seamAlpha * clamp((s0 - (F.dUp + F.dLo)) / s1, 0, 1));

    // Commissures: the shadow pockets the corners of a real mouth pinch into.
    // Without them the mouth stays flat however well the lips are shaded.
    // Two dots of radius ~2.7 units — under 2 device px at 1x — so they are
    // polygons: a 7-point closed spline apiece was 106 opcodes / 639 bytes in
    // every one of the 21 mouth poses to draw something smaller than the
    // rounding of its own coordinates.
    // …and they are where the corner channel finishes its sentence. A smile
    // DEEPENS the pocket and stretches it flat between the lips; a frown makes
    // it small and tall — a pinch, not a pocket. Both ride further into the
    // corner as the corner travels. It is geometry and not alpha because the
    // two pockets are ONE draw (one alpha for both sides would kill the
    // asymmetry that is the whole point of having cornerL and cornerR) and
    // because this mark is already opaque at rest: there is no headroom above
    // 1 to deepen into. Radius, aspect and offset have headroom both ways.
    const pocket = [[F.cornerL, 1, F.cPosL, F.cNegL], [F.cornerR, -1, F.cPosR, F.cNegR]];
    push('commiss', HEAD, contours(
      ...pocket.map(([p, d, cp, cn]) =>
        polygon(circle(
          p[0] + d * F.hw * M.commiss.dx * (1 + MAP.CM_DX * (cp + cn)),
          p[1] + 1,
          F.hw * M.commiss.r * (1 + MAP.CM_R * cp - MAP.CM_SHARP * cn),
          5,
          0.9 * (1 - MAP.CM_WIDE * cp + MAP.CM_ASP * cn)))),
    ), solid(PALETTE.commiss), M.commissAlpha,
    M.commiss.blend ? { blend: M.commiss.blend } : undefined);

    return out;
  }

  return { rest: mouthRestChannels(), draws, frame: (c, L) => mouthFrame(P, c, L) };
}
