// ---------------------------------------------------------------------------
// author/parts/skin-detail.mjs — small, stable identity marks.
//
// These marks intentionally have no expression channel. A profile is chosen
// once for a persona, then drawn from its solved upper-cheek landmarks every
// frame. Keeping them on the outer upper cheek leaves the mouth, eye lids and
// smile-compressing lower cheek unmarked while the head matrix and identity
// morphs still carry them with the face.
//
// `freckles` is a literal list of `{ side, along, lift, r }` records:
//   side   -1 viewer-left, +1 viewer-right
//   along  eye centre -> cheek contour, 0..1
//   lift   design px below that anchor (negative is higher)
//   r      design-px radius
// `mole` has the same fields. The empty default produces no draws, keeping a
// persona that did not opt in exactly as it was.
// ---------------------------------------------------------------------------

import { circle, spline } from '../path.mjs';
import { drawPusher, lerp } from '../rig.mjs';

export const SKIN_DETAIL = {
  opacity: 1,
  freckles: [],
  mole: null,
};

const sideKey = (side) => side < 0 ? 'L' : 'R';

function upperCheek(L, mark) {
  const k = sideKey(mark.side);
  const eye = L['eyeC' + k], cheek = L['chk' + k];
  return [
    lerp(eye[0], cheek[0], mark.along),
    lerp(eye[1], cheek[1], mark.along) + (mark.lift || 0),
  ];
}

function spot(push, slot, group, paint, alpha, L, mark) {
  const [x, y] = upperCheek(L, mark);
  const r = mark.r;
  push(slot, group,
    spline(circle(x, y, r, 5, mark.squash ?? 0.84), 0.72),
    paint, alpha);
}

export function makeSkinDetail({ PALETTE, solid, group = 'head', profile = {} }) {
  const D = { ...SKIN_DETAIL, ...profile };
  const freckles = Array.isArray(D.freckles) ? D.freckles : [];

  return {
    rest: {},
    draws(c, L) {
      if (!freckles.length && !D.mole) return [];
      const out = [], push = drawPusher(out);
      for (let i = 0; i < freckles.length; i++) {
        spot(push, `skinFreckle${i}`, group, solid(PALETTE.skinFleck),
          0.24 * D.opacity, L, freckles[i]);
      }
      if (D.mole) {
        spot(push, 'skinMole', group, solid(PALETTE.skinMole),
          0.54 * D.opacity, L, D.mole);
      }
      return out;
    },
  };
}
