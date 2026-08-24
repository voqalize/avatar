// ---------------------------------------------------------------------------
// author/rig.mjs — the authoring plumbing that survived a change of style.
//
// Two generators (avatars/facet, avatars/round) were written from scratch and
// then cloned across a style change. Exactly one layer came through
// byte-identical, and it is all in here: the paint registry, the control-vector
// machinery, the rebuild-and-diff pose harness, the small colour maths and the
// serialiser's contract defaults. Everything about the *character* — landmarks,
// geometry tables, the draw-builder body, palettes and ramps, control-channel
// names, lighting — deliberately stayed in each avatar's own build.mjs.
//
// Authoring-time only in intent — but PURE, and that is now load-bearing: it
// imports nothing from `node:`, so `avatars/round/face.mjs` (and the two parts
// under `parts/`, which import `clamp`/`lerp`/`drawPusher` back out of here)
// can be imported by a BROWSER. `src/live.js` evaluates the face at runtime and
// that is the whole chain it drags in. The one function that had to touch the
// filesystem, `writeRig`, moved to `finish.mjs` — its only caller — for exactly
// that reason.
// ---------------------------------------------------------------------------

import { r2, rotMat } from './path.mjs';
import { DRIVER_DEFAULTS } from '../src/vocab.js';
import { eyeRest } from './parts/eye.mjs';
import { mouthRest } from './parts/mouth.mjs';

// ---------------------------------------------------------------------------
// Small maths. Fifteen lines, copied byte-for-byte between both generators.
// ---------------------------------------------------------------------------

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), 1];
}

// ---------------------------------------------------------------------------
// Paint registry. Solids are deduped on a 3dp key, so a builder can call
// solid() freely from inside a loop without spraying near-identical entries.
// `paints` is the live array the serialiser wants; hold onto the reference.
// ---------------------------------------------------------------------------

export function paintRegistry() {
  const paints = [];
  const paintKey = new Map();
  function solid(c) {
    const k = c.map((v) => Math.round(v * 1000) / 1000).join(',');
    if (paintKey.has(k)) return paintKey.get(k);
    const i = paints.length;
    paints.push({ t: 'solid', c: [c[0], c[1], c[2], c[3]] });
    paintKey.set(k, i);
    return i;
  }
  return { paints, solid };
}

// ---------------------------------------------------------------------------
// The draw pusher, and the per-draw override hook.
//
// All three builders open with the same line: an `out` array and a `push` that
// appends `{ slot, group, cmds, paint, a }`. Two of them then spread a sixth
// argument over it, because `toRig` passes four more fields through verbatim
// (`stroke`, `rule`, `blend`, `m` — see author/README.md) and nothing offered a
// place to put them. This is that place:
//
//   push('limbal', HEAD, ring(...), solid(P.limbal), 1, { rule: 'evenodd' });
//   push('toothSh', HEAD, band(...), solid(P.toothSh), tA, { blend: 'multiply' });
//   push('faceInk', HEAD, spline(pts, 1), INK, 1, { stroke: STROKE(W_SIL) });
//
// `a` stays a POSITIONAL argument rather than joining the bag, and that is the
// distinction the hook is really drawing. `a` is a POSE CHANNEL: `rig.js`
// blends it frame by frame, so a shape can fade with the thing it belongs to
// (a lash that vanishes as the eye shuts, a seam that vanishes as the mouth
// opens) and the builder sets it from the control vector on nearly every
// interesting draw. The four in the bag are CONSTANTS of the draw — a rule, a
// composite op, a stroke width and a base matrix are copied from base to out
// and never interpolated — so they are rare, and they read better named.
//
// `extra` may be undefined or null; both spread to nothing.
// ---------------------------------------------------------------------------

export const drawPusher = (out) => (slot, group, cmds, paint, a = 1, extra) =>
  out.push({ slot, group, cmds, paint, a, ...extra });

// ---------------------------------------------------------------------------
// The control vector. REST is the character's own business — its channel names
// are one rigger's opinion about what one face can do — but the machinery that
// clones it and applies a shallow-with-one-level-of-nesting patch is not.
// ---------------------------------------------------------------------------

const clone = (o) => JSON.parse(JSON.stringify(o));

// The rest control vector. This started out as the one thing most obviously
// NOT library — "one rigger's opinion about what one face can do" — and then
// three independently-styled avatars turned out to hold it byte-for-byte
// identically, because it is not really an opinion about a face: it is the set
// of channels the DRIVER's vocabulary needs somebody to implement. Six identity
// morphs (one per `MORPH_AXES` entry), a jaw and a cheek for the visemes, an
// eye block for the six eye states, a mouth block for the sixteen visemes.
//
// It is a default, not a law: `makeCtrl` takes whatever rest vector it is
// given, and an avatar that grows a channel adds it to its own copy.
//
// The `eye:` and `mouth:` blocks are no longer written out here: they are the
// rest blocks of `parts/eye.mjs` and `parts/mouth.mjs`, so the channels a part
// implements and the channels the vector offers are defined in one place and
// cannot drift. Both are FUNCTIONS rather than consts on purpose — a part
// imports `clamp`/`lerp`/`drawPusher` back out of this file, and a function
// declaration is initialised before any module body runs, so the cycle is
// harmless whichever end of it a process happens to import first.
export const REST_CONTROLS = {
  headW: 0, eyeSize: 0, eyeSpace: 0, noseW: 0, lipFull: 0, browH: 0,
  // Sex axes. Unlike the six above these are NOT animated and NOT exposed as
  // morph poses: they are baked into the rest vector an avatar is built at
  // (`face.restFor(persona)` -> `poseHarness(builder, rest)`), so a man and a
  // woman of the same family are two builds of one skull rather than two
  // skulls. 0 is the family's neutral (feminine) read; 1 is fully masculine.
  //   jawWidth  — mandible width at the gonial corner, and how square it turns
  //   neckWidth — the neck, its cast shadow, and the collar it comes out of
  jawWidth: 0, neckWidth: 0,
  jaw: 0, cheekRaise: 0,
  eye: eyeRest(),
  mouth: mouthRest(),
};

// Which channel of that vector each `morph/<axis>_±100` pose name drives. The
// axis names are contract (src/vocab.js MORPH_AXES, straight out of the state
// machine); the channel names are this rest vector's. The map is the join
// between them, and it is the reason the morph poses can be enumerated by a
// library instead of retyped per avatar.
export const MORPH_CHANNELS = {
  head: 'headW', lips: 'lipFull', nose: 'noseW',
  brows: 'browH', eyes: 'eyeSize', distance: 'eyeSpace',
};

export function makeCtrl(REST) {
  return function ctrl(patch = {}) {
    const c = clone(REST);
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(c[k], v);
      else c[k] = v;
    }
    return c;
  };
}

// ---------------------------------------------------------------------------
// The pose harness — the single most valuable thing either generator had.
//
// A pose is "run the whole builder again with a different control vector and
// keep whatever moved". Because both runs go through the same code path, the
// cmds arrays are emitted by the same emitters in the same order, so the opcode
// sequence is identical by construction — which is the runtime's precondition
// for interpolating instead of snapping. Nothing else about the format makes
// that safety free.
//
// buildDraws(c) must return an array of { slot, group, cmds, a, paint }.
// ---------------------------------------------------------------------------

function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function poseHarness(buildDraws, rest) {
  const BASE = buildDraws(rest);
  const N = BASE.length;
  const IDX = Object.fromEntries(BASE.map((d, i) => [d.slot, i]));
  const group = (g) => BASE.map((d, i) => (d.group === g ? i : -1)).filter((i) => i >= 0);

  function poseOf(c) {
    const cur = buildDraws(c);
    const geo = {}, alpha = {};
    for (let i = 0; i < N; i++) {
      if (!same(cur[i].cmds, BASE[i].cmds)) geo[i] = cur[i].cmds;
      if (cur[i].a !== BASE[i].a) alpha[i] = cur[i].a;
    }
    const p = {};
    if (Object.keys(geo).length) p.geo = geo;
    if (Object.keys(alpha).length) p.alpha = alpha;
    return p;
  }

  return { BASE, N, IDX, group, poseOf };
}

// Poses are plain objects keyed by { geo, alpha, paint, mat }; stacking two of
// them is a per-section Object.assign, not a top-level one.
export const merge = (...ps) => {
  const o = {};
  for (const p of ps) for (const [k, v] of Object.entries(p)) o[k] = Object.assign(o[k] || {}, v);
  return o;
};

// The missing transform hierarchy. There is no parent/child in the format, so
// "move this group" means writing the same 6 numbers onto every draw index in
// it. Each argument is [drawIndices, matrix].
//
// A null matrix is skipped, and so is an IDENTITY one: `toRig` gives every draw
// base matrix [1,0,0,1,0,0], so writing identity onto a group says "these 119
// draws move by exactly nothing" in 119 entries the runtime still has to
// prepare, dirty and blend every frame. The rest key of a cyclic clip
// (`headMat(0, 0, 0, 0)`) is the case that hits it, and it was the whole of
// every zero-delta warning the checker used to emit. An empty result drops the
// section entirely, which is what makes a rest key `{}` — the one shape
// `validate.mjs` calls a legitimate whole-frame rest.
const isIdentity = (m) => m.length === 6
  && m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;

export const groupMat = (...pairs) => {
  const mat = {};
  for (const [indices, m] of pairs) {
    if (!m || isIdentity(m)) continue;
    for (const i of indices) mat[i] = m;
  }
  return Object.keys(mat).length ? { mat } : {};
};

// A body translate is the common second half of a head matrix.
export const translateMat = (ty) => [1, 0, 0, 1, 0, r2(ty)];

// ...and this is the whole of the first half. All three avatars had the same
// six lines: rotate the head group about the neck pivot, translate the body
// group, skip the body when it does not move. `head` and `body` are draw-index
// arrays from the harness's `group()`; the returned function is the one every
// track frame is written in terms of.
//
// It is plumbing, not performance: WHICH draws are in the head, where the
// pivot is, and how many degrees a given key turns are all the avatar's.
export function headMatFactory({ head, body, pivot }) {
  return (deg, tx = 0, ty = 0, bodyTy = 0) => groupMat(
    [head, rotMat(deg, pivot, tx, ty)],
    [body, bodyTy ? translateMat(bodyTy) : null],
  );
}

// ---------------------------------------------------------------------------
// The weight-table deformer. "Move every landmark by its share of one control"
// — a jaw drop, a cheek raise — written once instead of three times.
//
// The `L`/`R` rule is the part worth owning: a table is written in UNSUFFIXED
// landmark names because a weight is a property of the feature, not of which
// side of the face it is on, so `chin` covers `chinL` and `chinR` at once. The
// `?? table[n]` fallback then lets a table name one specific point that happens
// to end in L or R anyway, which is exactly the case one of the three copies
// had quietly dropped.
//
// fn(pt, w, name) mutates the point in place; what it does with the weight is
// the character's business (jaw drop also narrows, cheek raise only lifts).
// ---------------------------------------------------------------------------

export function applyWeights(pts, table, fn) {
  for (const n of Object.keys(pts)) {
    const w = table[n.replace(/[LR]$/, '')] ?? table[n];
    if (w) fn(pts[n], w, n);
  }
}

// ---------------------------------------------------------------------------
// The iris base solve.
//
// The driver never shows the base iris paint. It holds one or two `hue/NNN`
// rungs at a combined weight of 1 and layers `iris/eyes-saturation-0` and
// `iris/eyes-brightness-0` on top, and `rig.js:278-285` blends all of them in
// RGBA *against the base*:
//
//   shown = base + Σ wᵢ·(cᵢ − base)   =>   base = (Σ wᵢ·cᵢ − shown) / (Σ wᵢ − 1)
//
// At the driver's boot state the weights are 1, 1 − saturation and brightness,
// so Σ wᵢ = 2.35 and the divisor is 1.35. Which means the base paint an artist
// writes into the file is NOT a colour anyone picked — it is an answer to an
// equation whose coefficients live in `drivers.js`. That coupling, not the fact
// that three files would otherwise hold the same six lines, is why this is
// library: change the driver's defaults and every avatar's base iris is wrong,
// silently, and this is the one place that says so.
//
// `ladder.hue(h)` is the avatar's own hue ramp; `grey` and `bright` are the two
// overlay colours it puts in the two iris poses; `target` is the colour the
// eye should actually be on screen at boot.
// ---------------------------------------------------------------------------

export function solveIrisBase(target, ladder, defaults = DRIVER_DEFAULTS) {
  const H = ladder.hue(defaults.hue), G = ladder.grey, B = ladder.bright;
  const wH = 1, wS = 1 - defaults.saturation, wB = defaults.brightness;
  const div = wH + wS + wB - 1;
  return H.map((_, i) => Math.round((wH * H[i] + wS * G[i] + wB * B[i] - target[i]) / div));
}

// ---------------------------------------------------------------------------
// The camera.
//
// `render2d.js:60-68` computes, once per resize:
//
//   global = fit(meta.artboard onto the canvas) · inverse(meta.align)
//
// and `invSimilarity` inverts align as a similarity, so an align of
// [1/k, 0, 0, 1/k, cx, cy] takes a design-space point p to (p − c)·k. Set
// meta.artboard to the OUTPUT FRAME rather than to the space the art was drawn
// in and the pair becomes a camera: "crop this rectangle of design space and
// blow it up to fill this frame". Nothing else in the file moves — not a draw,
// not a pose, not a stroke width, not a bitmap. It is metadata, and it is the
// only kind of framing change that cannot introduce a fidelity bug.
//
// A camera is three numbers plus the frame:
//
//   camera: { frame: { w, h }, window: { cx, y, h } }
//
// where `frame` is the output raster's aspect (its absolute size only sets the
// units the player fits to) and `window` is the crop in DESIGN space: where it
// is centred horizontally, where its top edge is, how tall it is. The crop's
// WIDTH is derived from the frame's aspect and is not an input, because the one
// way to get this wrong is to write a window whose aspect disagrees with the
// frame's — the renderer would then letterbox inside the crop and every number
// the author computed would be off by that ratio. Three numbers cannot say it.
//
// Vertical-first is also how the framing is actually reasoned about: a portrait
// crop is chosen by "the head fills this fraction of the frame height and the
// eye line sits this far down", both of which are y.
// ---------------------------------------------------------------------------

const round6 = (v) => Math.round(v * 1e6) / 1e6;

export function cameraMeta({ frame, window: win }) {
  const bad = (m) => { throw new Error(`camera: ${m}`); };
  for (const [o, ks, n] of [[frame, ['w', 'h'], 'frame'], [win, ['cx', 'y', 'h'], 'window']]) {
    if (!o) bad(`${n} is required`);
    for (const k of ks) if (!Number.isFinite(o[k])) bad(`${n}.${k} must be a finite number, got ${o[k]}`);
  }
  if (frame.w <= 0 || frame.h <= 0) bad(`frame must be positive, got ${frame.w}x${frame.h}`);
  if (win.h <= 0) bad(`window.h must be positive, got ${win.h}`);
  const w = win.h * (frame.w / frame.h);      // the crop's width, never an input
  const k = frame.h / win.h;                  // design units -> frame pixels
  return {
    artboard: { w: frame.w, h: frame.h },
    align: [round6(1 / k), 0, 0, round6(1 / k), round6(win.cx - w / 2), round6(win.y)],
    window: { x: round6(win.cx - w / 2), y: round6(win.y), w: round6(w), h: round6(win.h), k: round6(k) },
  };
}

// ---------------------------------------------------------------------------
// Serialiser. Three of the four contract defaults below are load-bearing and
// none of them is checked by the runtime, which is the entire argument for a
// writer: clipsets[0] is the "no mask" index every draw points at, images must
// be present because loadRig maps over it unconditionally, and meta.align is
// divided out rather than applied, so a hand-authored rig with no camera wants
// identity and artboard-space coordinates.
// ---------------------------------------------------------------------------

export function toRig({ artboard, paints, draws, poses, tracks, camera, images = [] }) {
  // A bitmap draw is a different shape from a path one, not a path with extra
  // fields: `render2d.js:141` reads `src`, `m`, `a`, `blend` and `clip` and
  // nothing else, and a `cmds` on it would never be drawn. `images` is the
  // table `loadRig` maps over to fetch `img/<file>` next to the rig JSON, so an
  // entry's `id` is its own index and its `file` is a bare filename. Both are
  // empty for a vector-only avatar, which is what keeps those rigs' bytes.
  const d = draws.map((x) => (x.k === 'bitmap' ? {
    k: 'bitmap', slot: x.slot, m: x.m, a: x.a,
    blend: x.blend || 'source-over', clip: x.clip || 0, src: x.src, w: x.w, h: x.h,
  } : {
    // Four draw-level fields the two flat-fill avatars never set, so all four
    // were hard-coded. They are contract, not style: `m` is the draw's own
    // matrix (a pose's `mat` section overwrites it, so a non-identity base
    // matrix is how a shape sits somewhere its points do not), `blend` is the
    // canvas composite op (`render2d.js:124` reads `d.blend || 'source-over'`,
    // so 'multiply' is a legal shadow), and `rule` picks the fill rule
    // (`render2d.js:137`, `ctx.fill(path, d.rule)`) — the only way to say
    // "this contour is a hole". Each is passed through when a builder supplies
    // one and is byte-identical to the old constant when it does not.
    k: 'path', slot: x.slot, m: x.m || [1, 0, 0, 1, 0, 0], a: x.a,
    blend: x.blend || 'source-over', clip: 0, cmds: x.cmds, rule: x.rule || 'nonzero',
    // `stroke` is the one draw-level field the two flat-fill avatars never set,
    // so it was hard-coded to null. It is not style-agnostic to omit it:
    // `render2d.js` reads `if (d.stroke) { ...ctx.stroke() } else { ctx.fill() }`,
    // i.e. a draw is EITHER stroked or filled, and an outlined style needs the
    // stroked half. Passed straight through when a builder supplies one,
    // `{ w, cap, join }`; still exactly `null` when it does not, which is what
    // keeps facet's and round's bytes identical. Width is deliberately not a
    // pose channel — `rig.js` copies `stroke` from base to out and never blends
    // it, and there is no `stroke` section in a pose.
    stroke: x.stroke || null, paint: x.paint,
  }));
  // No camera: the frame IS the artboard and align is identity, which is what
  // every rig here emitted before cameras existed and what keeps those bytes.
  const cam = camera ? cameraMeta(camera) : null;
  return {
    meta: cam
      ? { artboard: cam.artboard, align: cam.align, drawCount: d.length }
      : { artboard, align: [1, 0, 0, 1, 0, 0], drawCount: d.length },
    paints, clipSlots: [], clipsets: [[]], draws: d, images, poses, tracks,
  };
}
