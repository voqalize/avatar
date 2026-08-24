// Canvas2D renderer for the blended display list.
//
// Rive's own canvas runtime paints vector art with Path2D and warps textured
// meshes separately; this does the same. Path2D objects are cached per draw and
// only rebuilt when that draw's geometry actually moved this frame, which keeps
// a viseme change to ~30 rebuilds out of 813 paths.

const mul = (A, B) => [
  A[0] * B[0] + A[2] * B[1],
  A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3],
  A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4],
  A[1] * B[4] + A[3] * B[5] + A[5],
];

const invSimilarity = ([s, , , , tx, ty]) => [1 / s, 0, 0, 1 / s, -tx / s, -ty / s];

export function buildPath(cmds) {
  const p = new Path2D();
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i];
    if (c === 0) { p.moveTo(cmds[i + 1], cmds[i + 2]); i += 3; }
    else if (c === 1) { p.lineTo(cmds[i + 1], cmds[i + 2]); i += 3; }
    else if (c === 2) { p.bezierCurveTo(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4], cmds[i + 5], cmds[i + 6]); i += 7; }
    else if (c === 3) { p.closePath(); i += 1; }
    else if (c === -1) {
      // A sub-path placed under its own matrix; Rive emits these for shapes
      // whose contours live in a different space than the shape itself.
      const n = cmds[i + 7];
      const sub = buildPath(cmds.subarray(i + 8, i + 8 + n));
      p.addPath(sub, new DOMMatrix([cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4], cmds[i + 5], cmds[i + 6]]));
      i += 8 + n;
    } else break;
  }
  return p;
}

const cssOf = (c) => `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;

export class Renderer2D {
  constructor(canvas, rig) {
    this.canvas = canvas;
    this.rig = rig;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.unalign = invSimilarity(rig.meta.align || [1, 0, 0, 1, 0, 0]);
    this.cache = rig.out.map(() => ({ gen: -1, path: null }));
    this.clipCache = new Map();
    this.gradCache = new Map();
    this.global = [1, 0, 0, 1, 0, 0];
    // Only 11 of the 824 draws are image-backed -- the hair, brows, suit,
    // glasses and a freckle texture. 'off' drops them so what is left is the
    // pure vector rig; 'ghost' leaves a flat silhouette in their place so you
    // can see the holes they would fill.
    this.bitmaps = 'on';           // on | off | ghost
    this.stats = { paths: 0, rebuilt: 0, tris: 0, images: 0 };
    this.resize();
  }

  resize(dpr = window.devicePixelRatio || 1) {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    const { w: aw, h: ah } = this.rig.meta.artboard;
    const s = Math.min(this.canvas.width / aw, this.canvas.height / ah);
    // contain + centre, then divide out the fit transform the extractor baked in
    this.global = mul([s, 0, 0, s, (this.canvas.width - aw * s) / 2, (this.canvas.height - ah * s) / 2], this.unalign);
    this.scale = s;
  }

  _path(d) {
    const c = this.cache[d.i];
    if (c.gen !== d.gen || !c.path) { c.path = buildPath(d.cmds); c.gen = d.gen; this.stats.rebuilt++; }
    return c.path;
  }

  // Masks deform along with the body, so their Path2D is cached on the same
  // gen counter the draws use rather than built once and kept forever.
  _clipPath(c) {
    let e = this.clipCache.get(c.i);
    if (!e || e.gen !== c.gen) { e = { gen: c.gen, path: buildPath(c.c) }; this.clipCache.set(c.i, e); }
    return e.path;
  }

  _paint(d) {
    if (d.colour) return d.colour;
    const p = this.rig.paints[d.paint];
    if (p.t === 'solid') return cssOf(p.c);
    let g = this.gradCache.get(d.paint);
    if (!g) {
      const ctx = this.ctx;
      const [x0, y0, x1, y1] = p.p;
      g = p.t === 'linear'
        ? ctx.createLinearGradient(x0, y0, x1, y1)
        : ctx.createRadialGradient(x0, y0, 0, x0, y0, Math.hypot(x1 - x0, y1 - y0));
      for (const [o, c] of p.stops) g.addColorStop(Math.min(1, Math.max(0, o)), cssOf(c));
      this.gradCache.set(d.paint, g);
    }
    return g;
  }

  draw() {
    const ctx = this.ctx, rig = this.rig, G = this.global;
    this.stats.paths = 0; this.stats.rebuilt = 0; this.stats.tris = 0; this.stats.images = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const d of rig.out) {
      if (!(d.a > 0.003)) continue;
      const set = rig.clipsets[d.clip];
      const clipped = set && set.length;
      if (clipped) {
        ctx.save();
        for (const id of set) {
          const c = rig.clipOut[id];
          const m = mul(G, c.m);
          ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
          ctx.clip(this._clipPath(c), c.r || 'nonzero');
        }
      }
      const m = mul(G, d.m);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.globalAlpha = d.a > 1 ? 1 : d.a;
      ctx.globalCompositeOperation = d.blend || 'source-over';

      if (d.k === 'path') {
        this.stats.paths++;
        const path = this._path(d);
        if (d.stroke) {
          ctx.strokeStyle = this._paint(d);
          ctx.lineWidth = d.stroke.w;
          ctx.lineCap = d.stroke.cap;
          ctx.lineJoin = d.stroke.join;
          ctx.stroke(path);
        } else {
          ctx.fillStyle = this._paint(d);
          ctx.fill(path, d.rule || 'nonzero');
        }
      } else if (this.bitmaps === 'off') {
        // nothing to draw: the image is what this slot is made of
      } else if (this.bitmaps === 'ghost') {
        this.stats.images++;
        this._ghost(ctx, d);
      } else if (d.k === 'bitmap') {
        this.stats.images++;
        ctx.drawImage(rig.images[d.src], 0, 0);
      } else if (d.k === 'mesh') {
        this.stats.images++;
        this._mesh(ctx, d, m);
      }

      if (clipped) ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // The footprint an image-backed draw occupies, as a flat fill: the mesh's own
  // triangles, or the image's rect for a plain blit. Useful for seeing exactly
  // which parts of the character a new persona would have to supply art for.
  _ghost(ctx, d) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#7c5cff';
    ctx.beginPath();
    if (d.k === 'mesh') {
      const V = d.verts, I = d.idx;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 2, b = I[t + 1] * 2, c = I[t + 2] * 2;
        ctx.moveTo(V[a], V[a + 1]); ctx.lineTo(V[b], V[b + 1]); ctx.lineTo(V[c], V[c + 1]);
        ctx.closePath();
      }
    } else ctx.rect(0, 0, d.w, d.h);
    ctx.fill();
  }

  // Deformable image mesh: for each triangle, solve the affine that carries its
  // UV triangle onto its deformed vertex triangle, clip to the triangle, and
  // blit the whole texture through it. Triangles are nudged outward from their
  // centroid by half a device pixel so shared edges do not show seams.
  _mesh(ctx, d, m) {
    const img = this.rig.images[d.src];
    if (!img) return;
    const V = d.verts, U = d.uvs, I = d.idx, W = img.width, H = img.height;
    const grow = 0.5 / (Math.hypot(m[0], m[1]) || 1);
    for (let t = 0; t < I.length; t += 3) {
      const i0 = I[t] * 2, i1 = I[t + 1] * 2, i2 = I[t + 2] * 2;
      let x0 = V[i0], y0 = V[i0 + 1], x1 = V[i1], y1 = V[i1 + 1], x2 = V[i2], y2 = V[i2 + 1];
      const s0x = U[i0] * W, s0y = U[i0 + 1] * H;
      const s1x = U[i1] * W, s1y = U[i1 + 1] * H;
      const s2x = U[i2] * W, s2y = U[i2 + 1] * H;
      const det = (s1x - s0x) * (s2y - s0y) - (s2x - s0x) * (s1y - s0y);
      if (!det) continue;
      const a = ((x1 - x0) * (s2y - s0y) - (x2 - x0) * (s1y - s0y)) / det;
      const c = ((x2 - x0) * (s1x - s0x) - (x1 - x0) * (s2x - s0x)) / det;
      const b = ((y1 - y0) * (s2y - s0y) - (y2 - y0) * (s1y - s0y)) / det;
      const dd = ((y2 - y0) * (s1x - s0x) - (y1 - y0) * (s2x - s0x)) / det;
      const e = x0 - a * s0x - c * s0y;
      const f = y0 - b * s0x - dd * s0y;

      const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
      const push = (x, y) => {
        const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1;
        return [x + (dx / l) * grow, y + (dy / l) * grow];
      };
      [x0, y0] = push(x0, y0); [x1, y1] = push(x1, y1); [x2, y2] = push(x2, y2);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
      ctx.clip();
      ctx.transform(a, b, c, dd, e, f);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      this.stats.tris++;
    }
  }
}
