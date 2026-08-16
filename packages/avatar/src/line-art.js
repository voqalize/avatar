/**
 * line-art — the variable-width stroke engine peep was built with.
 *
 * The construction idiom of the Open Peeps style is that NOTHING IS A STROKE:
 * every line is a filled outline whose width varies along its length, which is
 * what lets a mark swell in the middle and come to a point at the ends. A
 * uniform `stroke-width` with round caps is a rope with a blob at each end,
 * and it is the whole difference between "vector illustration" and "someone
 * drew this". Extracted from face-peep.js verbatim so the next line-art
 * character starts from the kit, not from a copy of peep.
 *
 * A curve is a flat list of points in polybezier form — [p0, c1, c2, p1, c3,
 * c4, p2, ...]. `widths` is a PROFILE across the whole mark, sampled at even
 * intervals: [3, 11, 3] means thin-fat-thin whether the curve has one Bézier
 * segment or six. Indexing per node instead is a trap — a one-segment curve
 * has only two nodes, so a third entry is never read and the mark comes out
 * blunt at one end.
 */

import { f } from './face-core.js';

export function toSegs(flat) {
  // Loud, because the failure is otherwise silent: a point count that is not
  // 3n+1 simply drops the trailing points and the mark comes out short with no
  // error anywhere.
  if (flat.length < 4 || (flat.length - 1) % 3 !== 0) {
    throw new Error(`curve needs 3n+1 points, got ${flat.length}`);
  }
  const out = [];
  for (let i = 0; i + 3 < flat.length; i += 3) out.push(flat.slice(i, i + 4));
  return out;
}

export const bezPt = (P, t) => {
  const u = 1 - t;
  return [0, 1].map(
    (i) => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]
  );
};
export const bezTan = (P, t) => {
  const u = 1 - t;
  return [0, 1].map(
    (i) => 3 * (u * u * (P[1][i] - P[0][i]) + 2 * u * t * (P[2][i] - P[1][i]) + t * t * (P[3][i] - P[2][i]))
  );
};

export function widthAt(ws, s) {
  const u = s * (ws.length - 1);
  const i = Math.min(Math.floor(u), ws.length - 2);
  return ws[i] + (ws[i + 1] - ws[i]) * (u - i);
}

/** Sample a polybezier: point, unit normal, and normalized position along it. */
export function walk(segs, per) {
  const out = [];
  segs.forEach((P, i) => {
    for (let k = i === 0 ? 0 : 1; k <= per; k++) {
      const t = k / per;
      const d = bezTan(P, t);
      const L = Math.hypot(d[0], d[1]) || 1;
      out.push({ p: bezPt(P, t), n: [-d[1] / L, d[0] / L], s: (i + t) / segs.length });
    }
  });
  return out;
}

export const polyD = (pts, cmd) =>
  pts.map(([x, y], i) => `${i ? 'L' : cmd}${f(x)} ${f(y)}`).join('');

/** An open tapered mark: offset ±w/2 along the normal and close the polygon. */
export function taper(flat, widths, per = 8) {
  const s = walk(toSegs(flat), per);
  const a = [], b = [];
  for (const { p, n, s: u } of s) {
    const h = widthAt(widths, u) / 2;
    a.push([p[0] + n[0] * h, p[1] + n[1] * h]);
    b.push([p[0] - n[0] * h, p[1] - n[1] * h]);
  }
  return polyD(a, 'M') + polyD(b.reverse(), 'L') + 'Z';
}

/**
 * A closed tapered outline — an annulus of varying width around a contour.
 * Two subpaths of opposite winding, so the inside is a hole under nonzero fill.
 */
export function taperRing(flat, widths, per = 8) {
  const s = walk(toSegs(flat), per);
  const a = [], b = [];
  for (const { p, n, s: u } of s) {
    const h = widthAt(widths, u) / 2;
    a.push([p[0] + n[0] * h, p[1] + n[1] * h]);
    b.push([p[0] - n[0] * h, p[1] - n[1] * h]);
  }
  return polyD(a, 'M') + 'Z' + polyD(b.reverse(), 'M') + 'Z';
}

/** The plain region a curve encloses — the white "background" path of a part. */
export function region(flat) {
  const segs = toSegs(flat);
  let d = `M${f(segs[0][0][0])} ${f(segs[0][0][1])}`;
  for (const P of segs) {
    d += `C${f(P[1][0])} ${f(P[1][1])} ${f(P[2][0])} ${f(P[2][1])} ${f(P[3][0])} ${f(P[3][1])}`;
  }
  return d + 'Z';
}

/**
 * On-curve points -> the polybezier form above, Catmull-Rom at the standard 1/6
 * tension. The house idiom for a FACE is hand-authored control points: a brow or
 * a lip contour is tuned a handle at a time and interpolation would fight that.
 * This is for marks whose geometry is easier to read as a list of places the
 * line goes through than as three-in-four control points — the hand's contours,
 * where the authoring question is "how far does the thumb clear the knuckles"
 * and every point is measured against another point. Curve control is worth
 * less there than a shape whose numbers can be argued about.
 */
export function smooth(pts) {
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

/** Deterministic jitter, so a drawing is the same every load. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
