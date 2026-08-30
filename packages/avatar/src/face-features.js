// ---------------------------------------------------------------------------
// face-features — the feature LAWS, with no drawing in them.
//
// `face-core.js` owns the plumbing a face needs and the body channels. This
// module owns the other half of the shared ground: the arithmetic that turns
// pose channels into feature geometry, for the features every line-art face
// has. It is deliberately three layers down from a "composable face", and the
// layering is the point:
//
//   1. THE SOLVE (here). Channels plus a handful of named scalars in, points
//      and numbers out. No DOM, no markup, no ids, no path strings except
//      where a path IS the geometry. One law per feature, and every face is a
//      point in it.
//   2. THE MARKS (the face module). Width profiles, brow point lists, which
//      optional layers exist at all. This is the drawing, and it does not
//      generalise — a generator that synthesised a brow arch from its
//      endpoints produced a hard V in every pose (see face-peep.js), which is
//      why poses deform authored points here and never replace them.
//   3. THE TYPE (the face module, composing layer 1). An eye that is one
//      filled lid curve and an eye that is a lid curve with a paper aperture
//      and an iris inside it are not one eye behind a flag. They are two
//      compositions of the SAME silhouette, and a third is a third
//      composition rather than a third branch.
//
// What earns a scalar here is a face that already differs in it. What does not
// is a knob nobody turns: the teeth in face-core.js take no spec at all
// because four rigs wrote them identically, and adding `toothWidth` would have
// been flexibility nobody asked for. Where two faces disagree, both state
// their number — there is no default to inherit by accident.
// ---------------------------------------------------------------------------

import { clamp, lerp } from './params.js';
import { f } from './face-core.js';

// ---------------------------------------------------------------------------
// The lid curve.
//
// Five rigs computed this and all five computed it identically: peep's
// `eyeGeom`, wren's and the control-plane study's inlined `eyePath`, and
// myna's `eyeGeom` — verified as identical path strings over every sampled
// lid, squint and tilt. Two of the five differ, and only in the two scalars
// below.
//
// The four shape constants are NOT spec'd, because nothing has ever varied
// them: the open lid rides to 1.05 of `ry` above centre and the shut one to
// 0.42; the lower lid opens to 1.05 below and closes to 0.05 above. A rig that
// wants a different eye SHAPE varies `rx`/`ry`, which is what those are for.
// ---------------------------------------------------------------------------

const TOP_OPEN = 1.05, TOP_SHUT = 0.42;
const BOT_OPEN = 1.05, BOT_SHUT = 0.05;

// A cubic whose two controls share a y reaches only 3/4 of the way to it.
// `lidCurve` returns DRAWN extents and `lensPath` divides that back out, so an
// inset of n units is n units on screen. It is module-private for that reason:
// the two halves are one arithmetic identity and must not drift apart.
const BULGE = 0.75;

/**
 * The lid silhouette, in drawn extents.
 *
 * `E` is the eye spec: `{ rx, ry, lidPow, squintGain }`.
 *
 *   lidPow      the ride from open to shut, as a power of the lid channel.
 *               1 on peep and wren. myna uses 0.6, and that is a finding
 *               rather than a taste: on beans that big a linear map had spent
 *               only 7% of its travel by the rest lid of 0.12, so rest
 *               rendered as a wide-eyed stare — a long-session comfort
 *               failure. It applies to the UPPER lid alone; the lower one
 *               rides linearly on every rig.
 *   squintGain  how much of `ry` a full squint lifts the lower lid. 0.7 on
 *               peep and wren, 0.95 on myna.
 */
export function lidCurve(E) {
  const pow = E.lidPow;
  return (cy, lid, squint) => {
    const L = clamp(lid);
    // Guarded rather than always calling Math.pow, so a rig with the linear
    // map gets the identical double it always got and not a round trip.
    const T = pow === 1 ? L : Math.pow(L, pow);
    const ctlTop = lerp(cy - E.ry * TOP_OPEN, cy - E.ry * TOP_SHUT, T);
    const ctlBot = lerp(cy + E.ry * BOT_OPEN, cy - E.ry * BOT_SHUT, L)
      - clamp(squint) * E.ry * E.squintGain;
    // Both representations, and that is deliberate. `ctlTop`/`ctlBot` are the
    // authored quantity and what `lensPath` actually draws with; `yTop`/`yBot`
    // are where the curve VISIBLY reaches, which is the space an aperture
    // inset has to be measured in (an inset of n units must be n units on
    // screen). Deriving one from the other at the call site is what the rigs
    // used to do, and it cost them: peep and myna multiplied by BULGE and
    // `lensPath` divided it back out, which is not the identity in floating
    // point and left their lower lid a hundredth of a unit off the number they
    // had computed. Carrying both loses nothing and rounds nothing twice.
    return {
      cyMid: cy,
      rx: E.rx,
      ctlTop,
      ctlBot,
      yTop: cy + BULGE * (ctlTop - cy),
      yBot: cy + BULGE * (ctlBot - cy),
    };
  };
}

/**
 * Drawn extents back to control points, for a geometry BUILT in drawn space —
 * an aperture inset off a lid line is the case that matters. A geometry that
 * already carries `ctlTop`/`ctlBot` is returned untouched, so the lid curve
 * never makes the round trip.
 */
export function toControls(g) {
  if (!g) return null;
  if (g.ctlTop !== undefined) return g;
  return {
    cyMid: g.cyMid,
    rx: g.rx,
    ctlTop: g.cyMid + (g.yTop - g.cyMid) / BULGE,
    ctlBot: g.cyMid + (g.yBot - g.cyMid) / BULGE,
  };
}

/**
 * A lid curve (or any two-arc lens: an aperture is the same shape inset) as a
 * path. Two cubics between (cx ± rx, cyMid) bulging to `yTop` and `yBot`,
 * rotated by `tiltDeg` about `cy` — the eye's own tilt, which is drawn
 * asymmetry and stays in the face module.
 *
 * Returns '' for a null geometry, which is how a lid that has shut on its own
 * aperture erases it without any opacity logic.
 */
export function lensPath(cx, cy, geom, tiltDeg) {
  const g = toControls(geom);
  if (!g) return '';
  const a = (tiltDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const R = (x, y) => {
    const dx = x - cx, dy = y - cy;
    return `${f(cx + dx * ca - dy * sa)} ${f(cy + dx * sa + dy * ca)}`;
  };
  const { ctlTop, ctlBot } = g;
  return (
    `M${R(cx - g.rx, g.cyMid)}` +
    `C${R(cx - g.rx * 0.5, ctlTop)} ${R(cx + g.rx * 0.5, ctlTop)} ${R(cx + g.rx, g.cyMid)}` +
    `C${R(cx + g.rx * 0.5, ctlBot)} ${R(cx - g.rx * 0.5, ctlBot)} ${R(cx - g.rx, g.cyMid)}Z`
  );
}

// ---------------------------------------------------------------------------
// The brow deformation.
//
// Four rigs wrote this. Three wrote the same six lines; myna wrote what looked
// like a different law and is in fact the GENERAL one — set `down` equal to
// `up`, `downSkew` and `bulk` to zero, and myna's arithmetic collapses onto
// peep's exactly. So there is nothing to reconcile and no art to re-judge:
// every rig is already a point in one law, and the law is myna's.
//
// `u` runs 0 at the inner end to 1 at the outer, so `inner` and `angle` each
// pivot their own end and fade out across the brow rather than translating the
// whole mark. That is the only reason they are separate channels.
// ---------------------------------------------------------------------------

/**
 * @param {{up: number, down: number, downSkew: number, inner: number,
 *          angle: number, bulk: number}} G  px of travel per unit of channel
 *
 *   up / down  a raised brow and a lowered one are different muscles and need
 *              not travel the same distance. Equal on peep, wren and the
 *              control-plane study; 20 against 8.5 on myna.
 *   downSkew   how much less the OUTER end falls than the inner. A lowered
 *              brow pivots; a translated one reads as a sticker.
 *   bulk       how much a lowered brow thickens, as a multiplier on the
 *              mark's own width profile. A frowning brow bunches.
 *
 * Returns the deformed points and the width multiplier; the face module owns
 * the profile those widths come from and does the drawing.
 */
export function browDeform(G) {
  return (pts, raise, angle, inner) => {
    const n = pts.length - 1;
    const up = Math.max(0, raise);
    const dn = Math.max(0, -raise);
    return {
      pts: pts.map(([x, y], i) => {
        const u = i / n;
        return [x, y - up * G.up + dn * G.down * (1 - G.downSkew * u)
          - inner * G.inner * (1 - u) - angle * G.angle * u];
      }),
      weight: 1 + G.bulk * dn,
    };
  };
}

/** Apply a brow's width multiplier to its profile, allocating nothing at 1. */
export const scaleWidths = (ws, k) => (k === 1 ? ws : ws.map((w) => w * k));

// ---------------------------------------------------------------------------
// The mouth contour.
//
// ONE closed contour used three ways — filled with ink for the interior,
// outlined with a tapered ring for the lips, and used as the clip for teeth and
// tongue. That is the whole model, and it is why a closed mouth needs no
// special case: at rest the contour is a degenerate lens, the fill collapses to
// nothing, and what is left is the ring.
//
// Three rigs solved it and two of them agreed on twenty-seven lines out of
// thirty; all three differences were scalars. The third, myna, adds one real
// law — press changes the mouth's SHAPE and not only its weight — and that is
// `pressNeutral` below.
//
// WHAT IS NOT HERE, deliberately: the width profile. `taperRing` samples a
// profile across the whole mark, so five stops against nine is topology rather
// than amplitude — peep's ring is thin-fat-thin-fat-thin, myna's carries a
// cupid's-bow notch — and the number of stops also decides which of them are
// the lip centres. It is the drawing. The face module passes a `lips(t, c)`
// returning `{ profile, halfUp, halfLo }`, and owns every one of those
// numbers. `t` is the press thinning already applied; `c` is the clamped
// channels, because a profile may be a SHAPE and not only a thickness —
// myna's cupid's-bow notch irons flat under press, which no amount of `t`
// can say.
// ---------------------------------------------------------------------------

/**
 * @param {object} S
 *   cx, cy         where the mouth sits
 *   widthBase      half-width at mouthWidth = 0…
 *   widthGain      …and what a full mouthWidth adds
 *   cornerPx       px of corner lift at a full smile
 *   aperture       px of VISIBLE DARK at mouthOpen = 1. Bounded by the chin,
 *                  not by taste: these rigs have no jaw drop, so a fully open
 *                  mouth has to fit the lower face that is already drawn.
 *   pressThin      how much a full press thins the lip band
 *   pressNeutral   how much a full press pulls the corner lift toward zero.
 *                  0 on peep and wren. myna spends it because a bilabial
 *                  closure has to render as a pressed BAND — corners
 *                  neutralised, bow ironed flat — or viseme A is
 *                  indistinguishable from idle X and the lipsync reads mushy
 *                  however good the timing is. The pressed band is the anchor
 *                  viewers use to verify sync, which is why this is a law and
 *                  not a nicety.
 */
export function mouthContour(S) {
  return (p, lips) => {
    const cx = S.cx, cy = S.cy;
    const open = clamp(p.mouthOpen);
    const round = clamp(p.mouthRound);
    const tuck = clamp(p.mouthTuck);
    const press = clamp(p.mouthPress);

    const w = (S.widthBase + clamp(p.mouthWidth) * S.widthGain) * (1 - 0.36 * round);

    const t = 1 - S.pressThin * press;
    const { profile, halfUp, halfLo } = lips(t, { open, round, tuck, press });

    // `mouthOpen` is the height of the DARK, not the separation of the two
    // centrelines. Those are not the same thing and the difference is the whole
    // lip band, so with the naive reading the mouth stayed shut until
    // mouthOpen passed 0.25 — which is above two of the nine visemes.
    const h = open * S.aperture;
    // …but only once the lips have actually parted. Compensating at open = 0
    // would prise the centrelines apart by the lip thickness and the resting
    // mouth would be a fat lens instead of the single tapered stroke these
    // faces are built around.
    const k = clamp(open / 0.18);

    // The corners rise while the middle stays put. That is a smile.
    const lift = 1 - S.pressNeutral * press;
    const yL = cy - (1.5 + p.mouthCornerL * S.cornerPx) * lift;
    const yR = cy - (1.5 + p.mouthCornerR * S.cornerPx) * lift;

    // The aperture opens DOWNWARD, 3:1. The upper lip is anchored to the
    // maxilla and barely moves; the lower rides the jaw. Splitting it evenly
    // is what makes an open mouth read as a cat's.
    const apTop = cy - h * 0.25;
    let apBot = cy + h * 0.75;
    // For F/V the lower lip rides up under the upper teeth, closing the
    // aperture from below rather than from above. The floor matters more than
    // the lift: an F that shuts completely is an M.
    if (tuck > 0) apBot = Math.max(apTop + 6, apBot - tuck * (h * 0.6 + 4));

    // Solve back from where the aperture must be to where the control points
    // go. A cubic reaches only 3/4 of the way from its endpoints to its
    // controls, and both cubics share the two corner endpoints, so the curve
    // midpoint is cornerMid + 0.75 * ctrlY. Inverting that is the only reason
    // this is not simply an offset.
    const cornerMid = (yL + yR) / 8;
    const topY = (apTop - k * halfUp - cornerMid) / 0.75;
    const botY = (apBot + k * halfLo - cornerMid) / 0.75;

    const contour = [
      [cx - w, yL],
      [cx - w * 0.55, topY], [cx + w * 0.55, topY], [cx + w, yR],
      [cx + w * 0.55, botY], [cx - w * 0.55, botY], [cx - w, yL],
    ];

    // Where the DARK actually is. Below the compensation ramp these come out
    // crossed — innerBot above innerTop — which is the correct answer for a
    // shut mouth and is what the teeth and the tongue test against.
    const innerTop = cornerMid + 0.75 * topY + halfUp;
    const innerBot = cornerMid + 0.75 * botY - halfLo;

    return { contour, profile, cx, cy, w, h, topY, botY, innerTop, innerBot, open, tuck };
  };
}
