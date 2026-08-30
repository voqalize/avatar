// ---------------------------------------------------------------------------
// face-eyes — the eye TYPES.
//
// `face-features.js` owns the lid silhouette, which every line-art rig here
// computes identically. This module owns what gets drawn ON that silhouette,
// and there is deliberately more than one answer:
//
//   beanEye  the lid curve, filled, and nothing over it. One mark.
//   irisEye  the lid curve, with a paper almond cut out of it and an ink iris
//            inside that. Three marks and a clip.
//
// THESE ARE NOT ONE EYE BEHIND A FLAG, and the difference is not a setting
// anyone should be able to flip. It is a consequence of the drawing around the
// eye, and the rule is worth stating because it decides the question for a new
// face before anything is rendered:
//
//   Does the drawing give the eye a FIXED REFERENCE FRAME to move against?
//
// wren's glasses are one. A solid bean shifting ten units inside a ring that
// does not move is a stronger gaze cue than any amount of structure inside the
// eye — measured, at the 130 px tile the avatar actually ships at: full-left
// to full-right gaze moves 98 pixels on the bean against 45 on an iris, while
// both carry within 2% of the same ink. peep's beans move against nothing, so
// peep needs the iris travelling inside an aperture to say where it is
// looking. Pick by the drawing, not by which eye sounds better.
//
// A third eye is a third function here. It is not a third branch in these two,
// and it is certainly not a fourth boolean on the spec.
//
// Both types take the elements they write, never element NAMES: the face
// module owns its markup, its ids, its paint order and what sits between the
// features, and hands down the four nodes this eye needs. Nothing here knows
// what a `<defs>` is.
// ---------------------------------------------------------------------------

import { f } from './face-core.js';
import { lidCurve, lensPath } from './face-features.js';

/**
 * The eye spec both types read.
 *
 *   rx, ry              the lid curve's half-extents
 *   lidPow, squintGain  see face-features.js
 *   lidFollow           how much of DOWNWARD gaze the lid follows. Looking up
 *                       genuinely widens the aperture, so there is nothing to
 *                       add on that side and the term is one-sided. 0.22 on
 *                       every rig so far, and still stated per face — a
 *                       constant four rigs happen to share is not yet a law.
 *
 * irisEye additionally reads:
 *   aperture {x, top, bot}  how far the lid line is inset to leave the paper
 *                           almond, in DRAWN units. `x` is the corner, where
 *                           the line must stay thin or the almond loses its
 *                           points and rounds back into a target shape.
 *   irisR                   sized to FILL the resting aperture's height rather
 *                           than float inside it, so both lids crop it and the
 *                           paper survives only as two corner slivers. An iris
 *                           small enough to sit clear of both lids draws three
 *                           concentric rings, which reads as a startle.
 *   irisTravel {x, y}       roughly one corner's worth of paper on x: at either
 *                           extreme one sliver closes and the other doubles,
 *                           which is the whole gaze signal.
 */

/** The paper almond inside the lid line, or null once the lid has shut on it. */
function apertureOf(g, A) {
  const yTop = g.yTop + A.top;
  const yBot = g.yBot - A.bot;
  const rx = g.rx - A.x;
  if (yBot - yTop < 0.5 || rx < 0.5) return null;
  return { cyMid: (yTop + yBot) / 2, rx, yTop, yBot };
}

/**
 * Both types return the lid geometry they solved, so a face can hang its own
 * extra marks off it — myna's lash rides the bean's own top control point —
 * without recomputing the curve or re-deriving the followed lid value.
 *
 * `s` is the per-eye state: `{ cx, cy, lid, squint, tilt, pupilX, pupilY }`.
 * `tilt` is the eye's own drawn asymmetry and stays the face's to supply.
 */
export function beanEye(E) {
  const curve = lidCurve(E);
  return (set, nodes, s) => {
    const g = curve(s.cy, s.lid + Math.max(0, s.pupilY) * E.lidFollow, s.squint);
    set(nodes.lid, 'd', lensPath(s.cx, s.cy, g, s.tilt));
    return g;
  };
}

export function irisEye(E) {
  const curve = lidCurve(E);
  return (set, nodes, s) => {
    const g = curve(s.cy, s.lid + Math.max(0, s.pupilY) * E.lidFollow, s.squint);
    const ap = apertureOf(g, E.aperture);
    const apD = lensPath(s.cx, s.cy, ap, s.tilt);
    set(nodes.aperture, 'd', apD);
    // The iris is clipped to the APERTURE, not to the lid line, so it is
    // cropped by the same edge the paper is — and a shut lid, which has no
    // aperture at all, takes the iris with it and needs no opacity logic.
    set(nodes.clip, 'd', apD);
    set(nodes.iris, 'cx', f(s.cx + s.pupilX * E.irisTravel.x));
    // Anchored to the aperture's midline rather than the eye's, so a
    // half-closed eye keeps the iris centred in the slit instead of showing a
    // band of paper above it.
    set(nodes.iris, 'cy', f((ap ? ap.cyMid : s.cy) + s.pupilY * E.irisTravel.y));
    set(nodes.iris, 'r', f(E.irisR));
    set(nodes.lid, 'd', lensPath(s.cx, s.cy, g, s.tilt));
    return g;
  };
}
