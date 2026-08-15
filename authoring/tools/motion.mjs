#!/usr/bin/env node
/**
 * Measure how much of the avatar actually moves, in delivered pixels.
 *
 *   node authoring/tools/motion.mjs --span 24 --state LISTENING -o .review/motion
 *
 * The one question the rest of the tooling cannot answer. `sweep()` proves the
 * parameters are finite, `contact-sheet` proves a pose is drawn, `clip-strip`
 * proves a gesture's phases — and all three are blind to the complaint that
 * brought this tool into being, which was that the body reads as a still image
 * with a moving face. That complaint is about a sequence, and it is about
 * amplitude at the size the thing is actually shown, so this samples a
 * deterministic run (authoring/body-lab.html seeds the RNG and steps by hand)
 * at 1:1 device pixels and reports:
 *
 *   motion map     per-pixel luminance range over the window, drawn as a heat
 *                  overlay. A dark torso in this image IS the complaint.
 *   edge probes    the silhouette tracked over time — where is the top of the
 *                  shoulder, where is the outer edge of the body — reported as
 *                  peak-to-peak travel in CSS pixels. This is the number that
 *                  matters: a channel that renders under ~1 px of travel is
 *                  not a subtle motion, it is no motion.
 *   channel range  peak-to-peak of every parameter, for attribution.
 *
 * Note the split between head band and torso band: the head has always moved
 * (blinks, saccades, sway), so a whole-frame number flatters the body. The
 * band boundary is measured off the render, not assumed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { startServer, launchBrowser, openSettled } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const face = opt('--face', 'peep');
const state = opt('--state', 'LISTENING');
const span = Number(opt('--span', 24));      // simulated seconds to sample
const frames = Number(opt('--frames', 96));  // samples across that span
const width = Number(opt('--w', 400));       // CSS px — a call tile is ~400x500
const seed = Number(opt('--seed', 7));
const talk = has('--talk') ? 1 : 0;
const user = has('--user') ? 1 : 0;
const outDir = opt('-o', '.review/motion');
const tag = opt('--tag', `${face}-${state}${talk ? '-talk' : ''}`);

const lum = (p, i) => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];

const server = await startServer();
const browser = await launchBrowser();
let shots = [];
try {
  const url = `authoring/body-lab.html?face=${face}&state=${state}&seed=${seed}`
    + `&w=${width}&talk=${talk}&user=${user}`;
  const { page, errors } = await openSettled(browser, server.port, url, {
    width: width + 40, height: 900, scale: 1, wait: 'window.ready',
  });
  if (errors.length) {
    console.error('page had errors — a measurement of a broken page is worse than none');
    for (const e of errors) console.error('  ' + e);
    process.exit(1);
  }
  const el = await page.$('#m');
  const channels = [];
  for (let i = 0; i < frames; i++) {
    const t = (span * i) / (frames - 1);
    await page.evaluate((tt) => window.stepTo(tt), t);
    channels.push(await page.evaluate(() => window.params()));
    shots.push(PNG.sync.read(await el.screenshot({ encoding: 'binary' })));
  }
  await measure(shots, channels);
} finally {
  await browser.close();
  server.close();
}

async function measure(pngs, channels) {
  const { width: W, height: H } = pngs[0];
  const N = pngs.length;

  // Background is whatever the corner is; ink is anything that differs from it.
  const bg = lum(pngs[0].data, 0);
  const isInk = (png, x, y) => Math.abs(lum(png.data, (y * W + x) * 4) - bg) > 24;

  // --- per-pixel luminance range ------------------------------------------
  const lo = new Float32Array(W * H).fill(255);
  const hi = new Float32Array(W * H).fill(-1);
  for (const png of pngs) {
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const v = lum(png.data, p);
      if (v < lo[i]) lo[i] = v;
      if (v > hi[i]) hi[i] = v;
    }
  }

  // --- band boundary: the top of the shoulder in a torso-only column -------
  // Columns at 12% and 88% of the width miss the head on every rig here, so
  // the first ink going down is the shoulder/arm line rather than hair.
  const colL = Math.round(W * 0.12), colR = Math.round(W * 0.88);
  const topInk = (png, x) => {
    for (let y = 0; y < H; y++) if (isInk(png, x, y)) return y;
    return H;
  };
  const shoulderY = topInk(pngs[0], colL);
  const bandY = Math.max(0, shoulderY - 4); // torso band starts at the shoulder

  // --- probes --------------------------------------------------------------
  // Two earlier attempts are worth recording, because both look reasonable and
  // both report zero on a body that is visibly moving.
  //
  // Silhouette edges: peep's shirt deliberately runs off both sides of the
  // viewBox (a white shirt on a white ground has to leave the frame or the
  // figure floats), so below the collar there is no outer edge inside the
  // picture at all.
  //
  // Ink centroid: defeated by the same overflow. Translate the torso right and
  // ink leaves the frame on the right exactly as fresh ink enters on the left,
  // so the centre of mass barely moves while every line in the band does.
  //
  // What works is registration: find the (dx, dy) that best aligns each frame
  // with the first one over a band, excluding a margin so clipped ink cannot
  // vote. That is a direct answer to "how far did this part of the drawing
  // travel", in the pixels the viewer is looking at.
  const STEP = 3, SEARCH = 10, MARGIN = 14;
  const register = (png, y0, y1) => {
    let best = { dx: 0, dy: 0, err: Infinity };
    for (let dy = -SEARCH; dy <= SEARCH; dy++) {
      for (let dx = -SEARCH; dx <= SEARCH; dx++) {
        let err = 0;
        for (let y = y0 + MARGIN; y < y1 - MARGIN; y += STEP) {
          const sy = y + dy;
          if (sy < 0 || sy >= H) { err = Infinity; break; }
          for (let x = MARGIN; x < W - MARGIN; x += STEP) {
            const sx = x + dx;
            if (sx < 0 || sx >= W) { err += 255; continue; }
            err += Math.abs(lum(pngs[0].data, (y * W + x) * 4) - lum(png.data, (sy * W + sx) * 4));
          }
        }
        if (err < best.err) best = { dx, dy, err };
      }
    }
    return best;
  };
  const torsoReg = pngs.map((p) => register(p, bandY, H));
  const headReg = pngs.map((p) => register(p, 0, bandY));
  const probes = {
    shoulderTopL: pngs.map((p) => topInk(p, colL)),
    shoulderTopR: pngs.map((p) => topInk(p, colR)),
    torsoShiftX: torsoReg.map((r) => r.dx),
    torsoShiftY: torsoReg.map((r) => r.dy),
    headShiftX: headReg.map((r) => r.dx),
    headShiftY: headReg.map((r) => r.dy),
  };
  const p2p = (a) => +(Math.max(...a) - Math.min(...a)).toFixed(2);

  // --- how much ink visibly changed, head band vs torso band ---------------
  const band = (y0, y1) => {
    let ink = 0, moved = 0, sum = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const r = hi[i] - lo[i];
        // "ink" = drawn in ANY frame, so a mark that moves into empty space counts.
        if (Math.abs(lo[i] - bg) > 24 || Math.abs(hi[i] - bg) > 24) ink++;
        if (r > 32) moved++;
        sum += r;
      }
    }
    return { ink, moved, movedPct: ink ? +(100 * moved / ink).toFixed(1) : 0,
             meanRange: +(sum / ((y1 - y0) * W)).toFixed(2) };
  };
  const head = band(0, bandY);
  const torso = band(bandY, H);

  // --- channel peak-to-peak ------------------------------------------------
  const chRange = {};
  for (const k of Object.keys(channels[0])) {
    const vals = channels.map((c) => c[k]);
    const r = Math.max(...vals) - Math.min(...vals);
    if (r > 0.0005) chRange[k] = +r.toFixed(4);
  }

  const report = {
    tag, face, state, span, frames, width: W, height: H,
    shoulderLineY: shoulderY,
    travelPx: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, p2p(v)])),
    headBand: head,
    torsoBand: torso,
    channelP2P: Object.fromEntries(
      Object.entries(chRange).sort((a, b) => b[1] - a[1])),
  };

  await mkdir(outDir, { recursive: true });
  const base = join(outDir, tag);
  await writeFile(base + '.json', JSON.stringify(report, null, 2));

  // --- the picture: frame 0 ghosted, motion burned over it in heat ---------
  const out = new PNG({ width: W, height: H });
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const g = 255 - (255 - lum(pngs[0].data, p)) * 0.16; // ghost of the drawing
    const r = hi[i] - lo[i];
    if (r <= 6) { out.data[p] = out.data[p + 1] = out.data[p + 2] = g; }
    else {
      // 6..96 of luminance range mapped blue -> red. Blue is "moves a little",
      // red is "moves a lot"; grey is "does not move at all".
      const k = Math.min(1, (r - 6) / 90);
      out.data[p] = Math.round(40 + 215 * k);
      out.data[p + 1] = Math.round(60 + 90 * (1 - Math.abs(k - 0.5) * 2));
      out.data[p + 2] = Math.round(230 - 200 * k);
    }
    out.data[p + 3] = 255;
  }
  // Band boundary, so the head/torso split in the numbers is visible in the image.
  for (let x = 0; x < W; x += 6) {
    const p = (bandY * W + x) * 4;
    out.data[p] = 0; out.data[p + 1] = 0; out.data[p + 2] = 0;
  }
  await writeFile(base + '-map.png', PNG.sync.write(out));

  // --- the two extremes of trunk position, superimposed --------------------
  // The map says where motion happened; this says how much, in a form a person
  // can judge rather than read. The two frames furthest apart laterally are
  // drawn over each other in red and blue: the width of the colour fringe IS
  // the excursion, and whether that excursion reads as a person re-settling or
  // as the drawing sliding is the call the numbers cannot make.
  const dxs = probes.torsoShiftX;
  const iMin = dxs.indexOf(Math.min(...dxs));
  const iMax = dxs.indexOf(Math.max(...dxs));
  const ov = new PNG({ width: W, height: H });
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const a = 1 - lum(pngs[iMin].data, p) / 255; // ink coverage, 0..1
    const b = 1 - lum(pngs[iMax].data, p) / 255;
    ov.data[p] = Math.round(255 * (1 - b));         // red where only iMin draws
    ov.data[p + 1] = Math.round(255 * (1 - Math.max(a, b)));
    ov.data[p + 2] = Math.round(255 * (1 - a));     // blue where only iMax draws
    ov.data[p + 3] = 255;
  }
  await writeFile(base + '-extremes.png', PNG.sync.write(ov));

  console.log(JSON.stringify(report, null, 2));
  console.log(`\n${base}.json\n${base}-map.png`);
}
