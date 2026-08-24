// ---------------------------------------------------------------------------
// author/parts/nose.mjs — a formed, low-contrast vector nose.
//
// A nose has no performance channel in the 30-float driver vocabulary. It is
// nevertheless a part: construction chooses a stable anatomical profile once;
// `draws(c, L)` spends the face's live landmarks every frame, so identity
// morphs, jaw travel and the head matrix move every plane together. There is
// no state or emotion inference here.
//
// `style: 'legacy'` emits round's former eight-point L tick byte for byte. It
// is the default because adopting a third author part must not move a rig that
// did not ask for it. `style: 'mature'` replaces that glyph with four quiet
// planes: one shadow-side bridge, a shallow underside, and two alar marks.
// ---------------------------------------------------------------------------

import { circle, spline } from '../path.mjs';
import { drawPusher, lerp } from '../rig.mjs';

export const NOSE_SHAPE = {
  style: 'legacy',       // legacy | mature
  bridge: 1,             // shadow-side bridge width
  base: 1,               // alar span / underside width
  nostril: 1,            // micro-alar mark size
  shadow: 1,             // all mature-mark opacity
};

/** A nose has no independent driver block; it is carried by face landmarks. */
export function noseRest() { return {}; }

const between = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

export function makeNose({ P, PALETTE, solid, group = 'head', shape = {} }) {
  const HEAD = group;
  const S = { ...NOSE_SHAPE, ...shape };

  function legacy(L) {
    const out = [];
    drawPusher(out)('nose', HEAD, spline(
      ['no1', 'no2', 'no3', 'no4', 'no5', 'no6', 'no7', 'no8'].map((n) => L[n]), 0.9),
    solid(PALETTE.nose));
    return out;
  }

  function mature(L) {
    const out = [];
    const push = drawPusher(out);
    const cx = P.cx;
    const tip = L.ntip;
    const wingL = L.nwingL, wingR = L.nwingR;
    const half = Math.max(1, (wingR[0] - wingL[0]) / 2);
    const root = between(L.glab, tip, 0.49);
    const baseY = (wingL[1] + wingR[1] + 2 * tip[1]) / 4;

    // A formed bridge is a plane, never a line. Its inside edge turns into the
    // tip before it reaches the nostril, so the viewer gets one continuous
    // surface rather than the old L-shaped contour.
    const bridge = [
      [cx + half * 0.10 * S.bridge, root[1] - 1],
      [cx + half * 0.29 * S.bridge, lerp(root[1], baseY, 0.42)],
      [cx + half * 0.55 * S.bridge, lerp(root[1], baseY, 0.79)],
      [cx + half * 0.36 * S.bridge, baseY + 1],
      [cx + half * 0.18 * S.bridge, lerp(root[1], baseY, 0.61)],
    ];
    push('noseBridge', HEAD, spline(bridge, 0.72), solid(PALETTE.noseBridge), 0.18 * S.shadow);

    // The underside makes the tip read in frontal light. It is deliberately
    // shallow: at 1× it is 3–4 screen px high, enough to locate a nose but
    // not enough to become a moustache-shaped outline.
    const span = half * 0.50 * S.base;
    const under = [
      [cx - span, baseY + 3],
      [cx - span * 0.42, baseY + 8],
      [cx, baseY + 10],
      [cx + span * 0.44, baseY + 8],
      [cx + span, baseY + 3],
      [cx + span * 0.36, baseY + 4],
      [cx, baseY + 6],
      [cx - span * 0.35, baseY + 4],
    ];
    push('noseUnder', HEAD, spline(under, 0.78), solid(PALETTE.noseUnder), 0.18 * S.shadow);

    // Two separate micro marks preserve the alar asymmetry of a lit face
    // without asserting a heavy outline. They are tied to the wing span, so
    // `morph/nose_±100` scales a nose rather than leaving two dots behind.
    for (const side of [-1, 1]) {
      const x = cx + side * half * 0.58 * S.base;
      const rx = half * 0.105 * S.nostril;
      const ry = 3.8 * S.nostril;
      push(`noseAlar${side < 0 ? 'L' : 'R'}`, HEAD,
        spline(circle(x, baseY + 5.2, rx, 5, ry / Math.max(rx, 1)), 0.75),
        solid(PALETTE.noseAlar), (side < 0 ? 0.14 : 0.24) * S.shadow);
    }
    return out;
  }

  return {
    rest: noseRest(),
    draws(c, L) { return S.style === 'mature' ? mature(L) : legacy(L); },
  };
}
