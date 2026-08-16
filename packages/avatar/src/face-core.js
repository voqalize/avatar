// ---------------------------------------------------------------------------
// face-core — the part of a face module that is not the face.
//
// Three avatars were built independently before this module existed, and their
// renderers converged on the same shape: an element table, a memoized attribute
// writer, and an apply() that runs torso lean → shoulders → parallax → eyes →
// brows → mouth → teeth → tongue. The geometry differs per character; the
// plumbing and the pose mechanics do not. This module absorbs the proven-
// identical parts, so a face module supplies art and feature geometry and gets
// the body mechanics for free.
//
// What lives here is exactly what those faces shared line-for-line, or differed
// in only by a named scalar. Anything a character has an opinion about — what
// an eye is, how a mouth is drawn — stays in the face module. Two of the three
// have since been retired; what they proved about the seam is why this file
// looks the way it does, and helpers only they used went with them.
// ---------------------------------------------------------------------------

import { clamp } from './params.js';

/** Attribute-value number formatter: 2 decimal places, no trailing zeros. */
export const f = (n) => (Math.round(n * 100) / 100).toString();

// Constants every rig agreed on. Named here so a new avatar inherits the
// agreement instead of re-deriving it.
export const LEAN_SCALE = 0.055; // scale gain at torsoLean = 1
export const ROLL_TORSO = 1.5;   // degrees of roll the torso follows…
export const ROLL_HEAD = 5.5;    // …versus what the head itself takes.

/**
 * Mount the static markup and return the per-instance tools: the svg root, an
 * id-scoped selector for building the element table, and the memoized `set`.
 * SVG attribute setting is the hot path; `set` skips redundant DOM writes.
 */
export function createFaceShell(mount, id, markupHtml) {
  mount.innerHTML = markupHtml;
  const svg = mount.querySelector(`#${id}`);
  const $ = (n) => svg.querySelector(`#${id}-${n}`);
  const prev = new Map();
  const set = (node, attr, val) => {
    const k = node.id + attr;
    if (prev.get(k) === val) return;
    prev.set(k, val);
    node.setAttribute(attr, val);
  };
  return { svg, $, set };
}

/** The one return shape every face honours: { svg, apply, theme, destroy }. */
export function faceApi(mount, svg, apply, theme) {
  return { svg, apply, theme, destroy: () => { mount.innerHTML = ''; } };
}

/**
 * Blocks A–C of every apply(): torso lean, shoulders, and the layer parallax
 * loop. `spec` is a module-level constant in the face module:
 *
 *   leanTravel   px of downward travel at torsoLean = 1
 *   leanPivot    {x, y} the scale pivot — behind the head, not the frame base:
 *                scaling about the bottom makes the head rise as it grows,
 *                which reads as standing up instead of leaning in
 *   shrugLift    px of shoulder lift at shrug = 1
 *   shrugTiltDeg degrees of one-sided-shrug rotation at tilt = 1 — a per-rig
 *                judgement about how much the collar can cover, not taste
 *   shrugPivot   {x, y} the sternum
 *   yawPx        px of head travel at headYaw = 1
 *   pitchPx      px at headPitch = 1
 *   pitch        optional corrective-pose contract for rigs that can nod:
 *                `{ headLayers, neckLayer, hinge, headTravel, neckTravel,
 *                   foreshorten, neckCompress, neckBase }`.
 *                `headLayers` must be separate SVG groups for the skull and
 *                its attached surface layers; `neckLayer` must be behind it.
 *                This is intentionally a small group-level contract, not a
 *                second set of authored paths per expression.
 *   pivot        {x, y} roll pivot — the base of the neck, not the chin:
 *                rotating about the chin swings the whole cranium sideways
 *                and reads as a puppet on a stick
 *   breathSwell  fractional scale of the torso layers at breath = 1, about
 *                `swellPivot`. Required. It replaced a rigid vertical bob of
 *                the whole shirt, which moved the hem — and the hem is the one
 *                part of a seated torso that does not move, so the result read
 *                as the figure being nudged up and down rather than as breath.
 *                A scale about the hem raises the shoulder line and widens the
 *                chest, which is what an inbreath does and is the only breath
 *                cue a head-and-shoulders crop can actually show.
 *   swellPivot   {x, y} the hem — bottom of the frame, on the midline
 *   turnPx       px of lateral trunk travel at torsoTurn = 1 (0 if the rig
 *                does not declare it)
 *   layers       draw-order list of layer names in the element table
 *   parallax     {layer: multiplier} — follows the art, not a standard
 *   torsoLayers  the subset of `layers` that moves at torso speed
 *   units        the rig's linear scale factor relative to the numbers above
 *                (1 where travels are already in the rig's own units). Kept as
 *                a separate factor, applied last, so a rig built by scaling
 *                another's numbers states that lineage — and so evaluation
 *                order matches code that wrote `travel * 9 * S` longhand.
 *                Degrees never take it: degrees are degrees at any scale.
 *
 * In a webcam frame a lean is read almost entirely as a change of scale, so
 * that is how it is drawn.
 */
export function poseTransforms(p, set, el, spec) {
  const u = spec.units;
  const lean = p.torsoLean;
  const leanT = lean
    ? `translate(0 ${f(lean * spec.leanTravel * u)}) `
      + `translate(${f(spec.leanPivot.x)} ${f(spec.leanPivot.y)}) `
      + `scale(${f(1 + lean * LEAN_SCALE)}) `
      + `translate(${f(-spec.leanPivot.x)} ${f(-spec.leanPivot.y)}) `
    : '';

  // One shoulder cannot rise without the other when the shirt is a single
  // path. A small rotation about the sternum is what a one-sided shrug looks
  // like anyway, and it needs no new geometry.
  const shrug = (p.shoulderL + p.shoulderR) * 0.5;
  const tilt = (p.shoulderR - p.shoulderL) * 0.5;

  // Breath as chest expansion. The swell scales the torso layers about the
  // hem, so the shoulder line rises and the chest widens while the bottom of
  // the shirt stays put. The head then has to ride whatever the shoulders did
  // or the neck telescopes — and that lift is not a tuned constant, it is
  // arithmetic: the swell's vertical displacement at the neck pivot. One
  // number to author, and the two layers cannot drift out of agreement.
  const swell = spec.breathSwell ? p.breath * spec.breathSwell : 0;
  const neckLift = swell ? swell * (spec.swellPivot.y - spec.pivot.y) : 0;
  const swellT = swell
    ? `translate(${f(spec.swellPivot.x)} ${f(spec.swellPivot.y)}) `
      + `scale(${f(1 + swell)}) `
      + `translate(${f(-spec.swellPivot.x)} ${f(-spec.swellPivot.y)}) `
    : '';

  const torsoT = `translate(${f(p.torsoTurn * (spec.turnPx || 0) * u)} ${f(-shrug * spec.shrugLift * u)}) `
    + `rotate(${f(-tilt * spec.shrugTiltDeg)} ${f(spec.shrugPivot.x)} ${f(spec.shrugPivot.y)}) `
    + swellT;

  const yx = p.headYaw * spec.yawPx;
  const py = p.headPitch * spec.pitchPx;
  const pitch = spec.pitch;
  for (const key of spec.layers) {
    const k = spec.parallax[key];
    const torso = spec.torsoLayers.includes(key);
    const roll = torso ? p.headRoll * ROLL_TORSO : p.headRoll * ROLL_HEAD;
    const isPitchHead = !!pitch && pitch.headLayers.includes(key);
    const isPitchNeck = !!pitch && pitch.neckLayer === key;
    // A pitch-capable rig makes its skull, features and hair move together:
    // their old parallax values still apply to yaw, but not to the vertical
    // nod. That coherence is the point of separating them from the neck.
    const pitchTravel = isPitchHead ? pitch.headTravel
      : isPitchNeck ? pitch.neckTravel : k;
    const pitchScale = isPitchHead
      ? 1 - Math.max(0, p.headPitch) * pitch.foreshorten : 1;
    const neckScale = isPitchNeck
      ? 1 - Math.max(0, p.headPitch) * pitch.neckCompress : 1;
    const pitchT = pitchScale !== 1
      ? `translate(${f(pitch.hinge.x)} ${f(pitch.hinge.y)}) scale(1 ${f(pitchScale)}) translate(${f(-pitch.hinge.x)} ${f(-pitch.hinge.y)}) `
      : '';
    const neckT = neckScale !== 1
      ? `translate(${f(pitch.neckBase.x)} ${f(pitch.neckBase.y)}) scale(1 ${f(neckScale)}) translate(${f(-pitch.neckBase.x)} ${f(-pitch.neckBase.y)}) `
      : '';
    // Torso layers get their breath from the swell inside torsoT; head layers
    // get the matching lift, which is derived from the swell rather than tuned
    // separately — the neck rides on the chest it sits on.
    const bob = torso ? 0 : -neckLift;
    set(el[key], 'transform',
      leanT + (torso ? torsoT : '')
      + pitchT + neckT
      + `translate(${f(yx * k)} ${f(py * pitchTravel + bob)}) rotate(${f(roll)} ${f(spec.pivot.x)} ${f(spec.pivot.y)})`);
  }
}

/**
 * Upper-and-lower teeth pair (peep, wren). Lower teeth appear only once
 * the mouth is genuinely open: below that the lower lip is over them and
 * drawing them turns every mid-open viseme into a grin; above it, their
 * absence is what made viseme D read as a cave.
 */
export function pairedTeeth(p, set, el, teethPath, m) {
  set(el.teeth, 'd', teethPath(m, clamp(p.teethUpper), false));
  set(el.teethLo, 'd', teethPath(m, clamp(p.teethUpper) * clamp((m.open - 0.45) / 0.4), true));
}
