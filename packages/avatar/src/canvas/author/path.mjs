// ---------------------------------------------------------------------------
// author/path.mjs — fixed-opcode path primitives.
//
// THE GUARANTEE, and the only reason this module exists:
//
//   every primitive here emits an opcode sequence that depends only on the
//   point COUNT, never on the point VALUES.
//
// `rig.js` blends a pose into the base by interpolating the cmds array float
// by float, opcodes included. So a pose is only interpolatable if its cmds
// array decodes to exactly the same opcode sequence as the base draw's: a
// moveTo (0) blending toward a bezierTo (2) passes through 1.0 = lineTo, and
// `buildPath` then reads the rest of the array at the wrong offsets and
// truncates the shape. Equal length is not enough; the sequence has to match.
//
// Because the count-not-values rule holds for every emitter below, "re-run the
// whole builder with a different control vector and diff" (see rig.mjs's pose
// harness) produces a blendable pose for free. Any emitter that adds a point
// conditionally — "a crease line when the mouth opens" — breaks the guarantee
// and does not belong here.
//
// Opcodes: 0 moveTo (2 operands), 1 lineTo (2), 2 bezierTo (6), 3 close (0).
// Authoring-time only; the player never loads this file.
// ---------------------------------------------------------------------------

// Coordinates are rounded to 2dp on the way into the cmds array. Poses are
// diffed for equality against the base, so the rounding also decides what
// counts as "moved" — sub-1/100th px jitter is not a pose.
export const r2 = (v) => Math.round(v * 100) / 100;

// Copy a point. Landmark tables alias points on purpose; anything that goes
// into a mutable run wants its own pair.
export function eqp(a) { return [a[0], a[1]]; }

// 3 + 3n opcodes for n points, always.
export function polygon(pts) {
  const c = [0, r2(pts[0][0]), r2(pts[0][1])];
  for (let i = 1; i < pts.length; i++) c.push(1, r2(pts[i][0]), r2(pts[i][1]));
  c.push(3);
  return c;
}

// Closed Catmull-Rom through the given points, emitted as cubic beziers. One
// bezier per point, so the opcode count is a pure function of pts.length —
// which is what keeps every pose of a given draw interpolatable.
export function spline(pts, tension = 1) {
  const n = pts.length, k = tension / 6;
  const at = (i) => pts[((i % n) + n) % n];
  const c = [0, r2(pts[0][0]), r2(pts[0][1])];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    c.push(2,
      r2(p1[0] + (p2[0] - p0[0]) * k), r2(p1[1] + (p2[1] - p0[1]) * k),
      r2(p2[0] - (p3[0] - p1[0]) * k), r2(p2[1] - (p3[1] - p1[1]) * k),
      r2(p2[0]), r2(p2[1]));
  }
  c.push(3);
  return c;
}

// The other half of `spline`: a run with two FREE ends. `spline` closes and
// strokes all the way round; an outlined style also needs a nose tick, a lid
// line, a hair strand — a stroke that starts somewhere and stops somewhere.
// 1 moveTo + (n-1) bezierTo and no close, so the opcode sequence is a pure
// function of pts.length and the guarantee at the top of this file holds.
//
// The END POLICY is style, so it is a parameter. `ends` receives the point
// array and returns the index accessor the Catmull-Rom tangents are read
// through — i.e. it decides what lies just outside the run. CLAMP_ENDS treats
// each endpoint as its own neighbour, which zeroes the outward component of
// the end tangents and is what stops a short run flicking out at the tips; a
// style that wants an open run to keep flowing past its last point would pass
// a reflecting or extrapolating accessor instead.
export const CLAMP_ENDS = (pts) => (i) => pts[i < 0 ? 0 : i >= pts.length ? pts.length - 1 : i];

export function openSpline(pts, tension = 1, ends = CLAMP_ENDS) {
  const n = pts.length, k = tension / 6;
  const at = ends(pts);
  const c = [0, r2(pts[0][0]), r2(pts[0][1])];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    c.push(2,
      r2(p1[0] + (p2[0] - p0[0]) * k), r2(p1[1] + (p2[1] - p0[1]) * k),
      r2(p2[0] - (p3[0] - p1[0]) * k), r2(p2[1] - (p3[1] - p1[1]) * k),
      r2(p2[0]), r2(p2[1]));
  }
  return c;
}

// A quadratic arc through three points, sampled evenly. Both eyelids and the
// sclera are built from the *same* samples of the same arc, which is the only
// reliable way to stop the white of the eye leaking past a lid: matching two
// splines' endpoints is not enough, their tangents differ.
export const arc = (a, m, b, n = 6) => {
  const q = [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * q[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * q[1] + t * t * b[1]]);
  }
  return out;
};

export const shift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);

// Scale a run about an EXPLICIT centre. Note what this is not: it is not an
// offset by a distance. Every point moves by `(k-1) * its own distance from
// (cx, cy)`, so the amount an EDGE moves depends on where that edge sits
// relative to the centre. That is right for "open the eye socket out from the
// eye's centre" and wrong for "grow this shape by 2px" — see `outsetTri`.
export const grow = (pts, cx, cy, k) => pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);

// Offset all three edges of a triangle OUTWARD by exactly `d`, by scaling it
// about its INCENTRE by (r + d)/r, where r is the inradius.
//
// This is the fix for the hairlines a faceted style gets between abutting
// triangles: Canvas2D antialiases every fill independently, so two triangles
// that share an edge composite to ~90% coverage along it and the background
// shows through. The cure is to make neighbours overlap instead of abut, and
// the amount of overlap has to be a DISTANCE.
//
// `grow(pts, centroid, k)` — the obvious version, and the one that shipped —
// does not give you one. A long thin triangle's vertices point along its own
// axis, so a centroid outset slides them end-to-end and moves the long edges
// almost not at all: the slivers, which are exactly where the hairlines are
// worst, get the least bleed. Scaling about the incentre offsets all three
// edges by the same `d` whatever the shape, because the incentre is by
// definition equidistant from all three.
//
// `maxK` caps the scale factor: as a triangle degenerates r -> 0 and the exact
// answer explodes. What the cap should be is a question about the mesh, not
// about geometry, so it is the caller's number.
//
// Fixed-opcode: 3 points in, 3 points out, values only.
export const outsetTri = (pts, d, maxK = Infinity) => {
  const e0 = Math.hypot(pts[1][0] - pts[2][0], pts[1][1] - pts[2][1]);
  const e1 = Math.hypot(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1]);
  const e2 = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
  const per = e0 + e1 + e2;
  const ix = (e0 * pts[0][0] + e1 * pts[1][0] + e2 * pts[2][0]) / per;
  const iy = (e0 * pts[0][1] + e1 * pts[1][1] + e2 * pts[2][1]) / per;
  const area = Math.abs((pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1])
    - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1])) / 2;
  const rin = (2 * area) / per || 1e-3;
  const k = Math.min(1 + d / rin, maxK);
  return pts.map(([x, y]) => [ix + (x - ix) * k, iy + (y - iy) * k]);
};

// Pull a point d px towards c. Used to bury a shape inside another one's
// silhouette: there is no clipping in the pipeline, so anything drawn on top of
// the face has to stop *short* of the outline or the overshoot lands on the
// background.
export const inward = ([x, y], [cx, cy], d) => {
  const dx = cx - x, dy = cy - y, l = Math.hypot(dx, dy) || 1;
  return [x + (dx / l) * d, y + (dy / l) * d];
};

// Walk the *same* Catmull-Rom curve `spline` emits and sample it. Two closed
// splines that share a run of control points still diverge, because the
// tangents at the ends of the run depend on the points outside it. Sampling the
// real curve and re-splining the samples fixes it for good, and the sample
// count depends only on the index range, so topology stays fixed.
export function sampleRun(pts, tension, from, to, per = 3) {
  const n = pts.length, k = tension / 6;
  const at = (i) => pts[((i % n) + n) % n];
  const out = [];
  for (let i = from; i < to; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    for (let j = 0; j < per; j++) {
      const t = j / per, u = 1 - t;
      out.push([
        u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
        u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1],
      ]);
    }
  }
  out.push(eqp(at(to)));
  return out;
}

// ---------------------------------------------------------------------------
// Bands: the shape between two runs.
//
// Everything a flat-fill style draws that a stroke cannot — a tapering lash, a
// lid's cast shadow, a waterline, a lip seam, the shadow plane down one side
// of a face — is the region between two runs of the SAME length. It is worth a
// name because of what that buys: both edges are built from the same samples
// of the same arc, so the shape tracks every pose of that arc for free, with
// no pose entry of its own and no chance of the two edges drifting apart.
//
// It is also the only variable-width mark this pipeline can make. `stroke.w`
// is a scalar per draw and `rig.js` never blends it (see author/README.md), so
// a stroke cannot taper; a filled band between an arc and the same arc pushed
// off by a profile can.
// ---------------------------------------------------------------------------

// The closed ring of points: down `top`, back along `bot`. Non-mutating —
// `bot` is very often a run somebody else is still holding.
// Fixed-opcode: the ring is always top.length + bot.length points.
export const strip = (top, bot) => [...top, ...bot.slice().reverse()];

// `strip`, splined. The tension is style and there is no useful default beyond
// `spline`'s own, so say it.
export const band = (top, bot, tension = 1) => spline(strip(top, bot), tension);

// Offset a run vertically by a one-hump profile:
//
//   y' = y + floor + amp * sin(PI * t^skew) ^ power        t = i / (n-1)
//
// which is the "same arc, pushed off by a sine" that every band's second edge
// is made of. Each knob earns its place at a real call site: `amp` is the
// depth at the peak (negative pushes up), `floor` keeps a thin constant offset
// where the hump is zero (a lash line that continues inward as a lid line),
// `skew` slides the peak off centre (t^1.8 puts it at ~0.68, which is where the
// mass of a real lash sits), `power` sharpens or flattens the hump, and `pin`
// nails the two endpoints back onto the input.
//
// `pin` is not the same as `floor = 0`: a band whose edges meet exactly at the
// ends closes to a point, and a band that ends `floor` px apart ends in a pair
// of free-floating whiskers just outside the eye corners — invisible at 1x and
// obvious at 2x. Which of the two you want is the shape's business.
//
// Fixed-opcode: one point out per point in, values only.
export const bulge = (pts, amp, { floor = 0, skew = 1, power = 1, pin = false } = {}) =>
  pts.map(([x, y], i) => {
    if (pin && (i === 0 || i === pts.length - 1)) return [x, y];
    const t = i / (pts.length - 1);
    return [x, y + floor + amp * Math.pow(Math.sin(Math.PI * Math.pow(t, skew)), power)];
  });

// Several disjoint contours in ONE draw. A cmds array may hold any number of
// closed contours; `nonzero` fills them all, and `rule: 'evenodd'` makes an
// enclosed one a hole. So a pair of lash ticks, a pair of commissure dots or
// three tooth separators is one draw and one paint, not two or three — which
// is the whole of the draw budget, and the reason `rule` is a passthrough
// field on `toRig`.
// Fixed-opcode: the concatenation of its arguments' opcode sequences, so it is
// fixed exactly when each run is.
export const contours = (...runs) => runs.flat();

// `n` points evenly around an ellipse, for feeding to `spline`. It has no
// default point count on purpose: `n` is this shape's whole topology, and a
// default is an invitation to write `circle(x, y, r)` for the base draw and
// `circle(x, y, r, 8)` for a pose, which is a rig that interpolates into
// garbage and nothing but validate.mjs to catch it. Say the number every time.
export const circle = (cx, cy, r, n, sq = 1) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * sq]);
  }
  return pts;
};

// An annulus: two concentric contours in one path, to be filled `evenodd` so
// the inner one is a hole. `emit` is the style — `polygon` for a faceted look,
// the default closed spline for a smooth one — and both contours get the same
// `n`, so the pair stays interpolatable as one shape.
//
// The two RADII are given, not a radius and a width, because the two callers
// wrote the inner one two different ways (`r - w` and `r * 0.885`) and the
// library has no opinion about which; taking a width would have forced one of
// them through an extra subtraction for nothing.
//
// Why an avatar wants this at all: it is how a limbal ring stays a TRANSLUCENT
// overlay (see author/README.md, "the translucent-overlay convention") instead
// of a darkened copy of the iris colour. The hue ladder repaints the iris 39
// times and only swaps the iris draws' paint; a derived colour would have to be
// recomputed at every rung, an overlay does not.
export const ring = (cx, cy, rOuter, rInner, n, emit = (p) => spline(p, 1)) =>
  contours(emit(circle(cx, cy, rOuter, n)), emit(circle(cx, cy, rInner, n)));

// A 6-number affine, rotating `deg` about `pivot` then translating. The format
// has no transform hierarchy, so this is what "turn the head" is made of.
export const rotMat = (deg, pivot, tx = 0, ty = 0) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [r2(c), r2(s), r2(-s), r2(c),
    r2(pivot[0] - (c * pivot[0] - s * pivot[1]) + tx),
    r2(pivot[1] - (s * pivot[0] + c * pivot[1]) + ty)];
};
