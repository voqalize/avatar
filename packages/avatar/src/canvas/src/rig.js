// The rig: a base display list plus a library of poses stored as differences
// from it. Blending is additive — v = base + Σ wᵢ·(poseᵢ − base) — so two
// weights of 0.5 give a true half-way blend regardless of the order they are
// listed in. That is the one place we deliberately differ from Rive, which
// lerps sequentially and is therefore order-dependent.

const EPS = 1e-4;

// Deltas arrive keyed by draw index. Flatten them into tuple lists once, and
// record the union of touched indices so a frame only rebuilds what moved.
function prepare(delta) {
  const touch = new Set();
  const pairs = (src, cast) => {
    if (!src) return null;
    const out = [];
    for (const k of Object.keys(src)) { const i = +k; touch.add(i); out.push([i, cast(src[k])]); }
    return out.length ? out : null;
  };
  const F = (a) => Float32Array.from(a);
  const id = (v) => v;
  const p = {
    mat: pairs(delta.mat, F),
    geo: pairs(delta.geo, F),
    verts: pairs(delta.verts, F),
    alpha: pairs(delta.alpha, id),
    paint: pairs(delta.paint, id),
    clip: pairs(delta.clip, id),
    src: pairs(delta.src, id),
    hide: null,
  };
  if (delta.hide && delta.hide.length) {
    p.hide = delta.hide.slice();
    for (const i of p.hide) touch.add(i);
  }
  p.touch = Int32Array.from(touch);

  // Masks are indexed by clip slot rather than draw index, so they need their
  // own dirty set. A mask moving is the common case -- it rides the body -- and
  // it must interpolate, not snap, or its edge pops while the art glides.
  const ctouch = new Set();
  const cpairs = (src, cast) => {
    if (!src) return null;
    const out = [];
    for (const k of Object.keys(src)) { const i = +k; ctouch.add(i); out.push([i, cast(src[k])]); }
    return out.length ? out : null;
  };
  p.cmat = cpairs(delta.cmat, F);
  p.cgeo = cpairs(delta.cgeo, F);
  p.ctouch = Int32Array.from(ctouch);
  return p;
}

export class Rig {
  constructor(data, images) {
    this.data = data;
    this.images = images;
    this.meta = data.meta;
    this.paints = data.paints;
    this.clipsets = data.clipsets;   // arrays of clip-slot ids

    // Live mask state, mirroring the draw list: base kept for restore, an out
    // buffer that poses blend into, and a gen counter the renderer caches on.
    this.clipBase = data.clipSlots.map((c) => ({
      m: Float32Array.from(c.m), c: Float32Array.from(c.c), r: c.r,
    }));
    this.clipOut = this.clipBase.map((b, i) => ({
      i, r: b.r, m: Float32Array.from(b.m), c: Float32Array.from(b.c), gen: 0,
    }));
    this.clipOut.forEach((o) => { o._c = o.c; });

    this.base = data.draws.map((d) => ({
      k: d.k, m: Float32Array.from(d.m), a: d.a, blend: d.blend, clip: d.clip,
      rule: d.rule, stroke: d.stroke, paint: d.paint, src: d.src, w: d.w, h: d.h,
      cmds: d.cmds ? Float32Array.from(d.cmds) : null,
      verts: d.verts ? Float32Array.from(d.verts) : null,
      uvs: d.uvs ? Float32Array.from(d.uvs) : null,
      idx: d.idx ? Uint16Array.from(d.idx) : null,
    }));

    // Live display list. cmds/verts get their own scratch buffers so a pose
    // that has to snap (topology change) can swap its array in and back out.
    this.out = this.base.map((b, i) => {
      const o = {
        i, k: b.k, blend: b.blend, rule: b.rule, stroke: b.stroke,
        src: b.src, w: b.w, h: b.h, uvs: b.uvs, idx: b.idx,
        m: Float32Array.from(b.m), a: b.a, clip: b.clip, paint: b.paint,
        colour: null,   // set when paint blending produced a plain colour
        gen: 0,
      };
      o._cmds = b.cmds ? Float32Array.from(b.cmds) : null;
      o._verts = b.verts ? Float32Array.from(b.verts) : null;
      o.cmds = o._cmds;
      o.verts = o._verts;
      o._geoDirty = false;
      return o;
    });

    this.poses = {};
    for (const [name, d] of Object.entries(data.poses)) this.poses[name] = prepare(d);

    // A sampled timeline is just an ordered set of poses; playing it is a
    // two-weight blend between the frames either side of the cursor. Reusing
    // the pose machinery means ambient motion costs nothing extra.
    this.tracks = {};
    for (const [name, t] of Object.entries(data.tracks || {})) {
      const keys = t.frames.map((f, j) => {
        const key = `@${name}/${j}`;
        this.poses[key] = prepare(f);
        return key;
      });
      // `at` holds each key's normalised position in the clip. Keys are placed
      // where the motion is, so they are not evenly spaced and playback has to
      // search rather than divide.
      this.tracks[name] = { period: t.period, loop: t.loop, at: t.at, keys };
    }

    this.dirty = new Set();
    this.cdirty = new Set();
    this.frame = 0;
    this._acc = new Map();   // draw index -> paint accumulator, reused each frame
  }

  restore(i) {
    const o = this.out[i], b = this.base[i];
    o.m.set(b.m);
    o.a = b.a;
    o.clip = b.clip;
    o.paint = b.paint;
    o.src = b.src;
    o.colour = null;
    // Only touch geometry if a pose actually moved it last frame. Ambient
    // motion is almost pure matrix work, so this keeps the renderer's Path2D
    // cache warm for ~800 of the 813 paths.
    if (o._geoDirty) {
      if (b.cmds) { o.cmds = o._cmds; o.cmds.set(b.cmds); }
      if (b.verts) { o.verts = o._verts; o.verts.set(b.verts); }
      o.gen = this.frame;
      o._geoDirty = false;
    }
  }

  restoreClip(i) {
    const o = this.clipOut[i], b = this.clipBase[i];
    o.m.set(b.m);
    o.c = o._c;
    o.c.set(b.c);
    o.gen = this.frame;
  }

  // weights: { poseName: 0..1 }. Anything absent is zero.
  evaluate(weights) {
    this.frame++;
    const out = this.out, base = this.base;

    for (const i of this.dirty) this.restore(i);
    this.dirty.clear();
    for (const i of this.cdirty) this.restoreClip(i);
    this.cdirty.clear();

    const act = [];
    for (const name of Object.keys(weights)) {
      const w = weights[name];
      if (!(w > EPS || w < -EPS)) continue;   // spline weights may go negative
      const p = this.poses[name];
      if (!p) continue;
      act.push(p, w);
      const t = p.touch;
      for (let j = 0; j < t.length; j++) this.dirty.add(t[j]);
      const ct = p.ctouch;
      for (let j = 0; j < ct.length; j++) this.cdirty.add(ct[j]);
    }

    const acc = this._acc;
    acc.clear();
    const slot = (i) => {
      let s = acc.get(i);
      if (!s) { s = { paint: -1, pw: 0, clip: -1, cw: 0, geoSnap: null, gw: 0, src: -1, sw: 0 }; acc.set(i, s); }
      return s;
    };
    const cacc = new Map();
    const cslot = (i) => {
      let s = cacc.get(i);
      if (!s) { s = { snap: null, gw: 0 }; cacc.set(i, s); }
      return s;
    };

    for (let a = 0; a < act.length; a += 2) {
      const p = act[a], w = act[a + 1];

      if (p.mat) for (const [i, v] of p.mat) {
        const o = out[i].m, b = base[i].m;
        for (let j = 0; j < 6; j++) o[j] += w * (v[j] - b[j]);
      }

      if (p.geo) for (const [i, v] of p.geo) {
        const d = out[i], b = base[i].cmds;
        d.gen = this.frame; d._geoDirty = true;
        if (v.length !== b.length) {
          // Topology changed, so there is nothing to interpolate between.
          // Snap to whichever competing pose is pulling hardest.
          const s = slot(i);
          if (w > s.gw) { s.gw = w; s.geoSnap = v; }
        } else {
          const o = d.cmds === d._cmds ? d.cmds : d._cmds;
          for (let j = 0; j < v.length; j++) o[j] += w * (v[j] - b[j]);
        }
      }

      if (p.verts) for (const [i, v] of p.verts) {
        const d = out[i], b = base[i].verts, o = d.verts;
        d.gen = this.frame; d._geoDirty = true;
        for (let j = 0; j < v.length; j++) o[j] += w * (v[j] - b[j]);
      }

      if (p.alpha) for (const [i, v] of p.alpha) out[i].a += w * (v - base[i].a);
      if (p.hide) for (const i of p.hide) out[i].a += w * (0 - base[i].a);

      if (p.paint) for (const [i, v] of p.paint) {
        const s = slot(i);
        s.list = s.list || [];
        s.list.push(v, w);
      }
      if (p.clip) for (const [i, v] of p.clip) {
        const s = slot(i);
        if (w > s.cw) { s.cw = w; s.clip = v; }
      }
      if (p.cmat) for (const [i, v] of p.cmat) {
        const o = this.clipOut[i].m, b = this.clipBase[i].m;
        for (let j = 0; j < 6; j++) o[j] += w * (v[j] - b[j]);
        this.clipOut[i].gen = this.frame;
      }

      if (p.cgeo) for (const [i, v] of p.cgeo) {
        const d = this.clipOut[i], b = this.clipBase[i].c;
        d.gen = this.frame;
        if (v.length !== b.length) {
          const s = cslot(i);
          if (w > s.gw) { s.gw = w; s.snap = v; }
        } else {
          const o = d.c === d._c ? d.c : d._c;
          for (let j = 0; j < v.length; j++) o[j] += w * (v[j] - b[j]);
        }
      }

      // A texture swap has no midpoint, so it flips with the dominant pose.
      if (p.src) for (const [i, v] of p.src) {
        const s = slot(i);
        if (w > s.sw) { s.sw = w; s.src = v; }
      }
    }

    for (const [i, s] of cacc) if (s.snap && s.gw > 0.5) this.clipOut[i].c = s.snap;

    for (const [i, s] of acc) {
      const d = out[i];
      if (s.geoSnap && s.gw > 0.5) d.cmds = s.geoSnap;
      if (s.clip >= 0 && s.cw > 0.5) d.clip = s.clip;
      if (s.src >= 0 && s.sw > 0.5) d.src = s.src;
      if (s.list) this._resolvePaint(d, base[i].paint, s.list);
    }

    return out;
  }

  // Solid-to-solid paint changes blend in RGBA, which is what the eye-hue
  // ladder and the viseme lip tints need. Anything involving a gradient has no
  // meaningful midpoint, so it snaps at the halfway mark instead.
  _resolvePaint(d, basePaint, list) {
    const P = this.paints;
    const b = P[basePaint];
    let allSolid = b.t === 'solid';
    let best = -1, bw = 0;
    for (let j = 0; j < list.length; j += 2) {
      if (P[list[j]].t !== 'solid') allSolid = false;
      if (list[j + 1] > bw) { bw = list[j + 1]; best = list[j]; }
    }
    if (!allSolid) { if (bw > 0.5) { d.paint = best; d.colour = null; } return; }
    const c = [b.c[0], b.c[1], b.c[2], b.c[3]];
    for (let j = 0; j < list.length; j += 2) {
      const v = P[list[j]].c, w = list[j + 1];
      for (let k = 0; k < 4; k++) c[k] += w * (v[k] - b.c[k]);
    }
    const q = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
    d.paint = basePaint;
    d.colour = `rgba(${q(c[0])},${q(c[1])},${q(c[2])},${Math.min(1, Math.max(0, c[3])).toFixed(3)})`;
  }
}

export async function loadRig(url) {
  const base = new URL(url, location.href);
  const data = await (await fetch(base)).json();
  const images = await Promise.all(data.images.map(async (im) => {
    const r = await fetch(new URL('img/' + im.file, base));
    return createImageBitmap(await r.blob());
  }));
  return new Rig(data, images);
}
