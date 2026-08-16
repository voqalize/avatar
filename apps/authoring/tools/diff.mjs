#!/usr/bin/env node
/**
 * Compare two PNGs pixel by pixel.
 *
 *   node apps/authoring/tools/diff.mjs a.png b.png [-o diff.png] [--threshold 0]
 *
 * Prints the changed-pixel count and percentage; exits non-zero when the count
 * exceeds --threshold (default 0, i.e. any difference fails). Dimension
 * mismatch is always a failure. Use after re-rendering a baseline to prove a
 * refactor changed nothing on screen.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('-'));
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
if (files.length !== 2) {
  console.error('usage: node apps/authoring/tools/diff.mjs a.png b.png [-o diff.png] [--threshold 0]');
  process.exit(2);
}
const [aPath, bPath] = files;
const out = opt('-o');
const threshold = Number(opt('--threshold', 0));

const a = PNG.sync.read(readFileSync(aPath));
const b = PNG.sync.read(readFileSync(bPath));
if (a.width !== b.width || a.height !== b.height) {
  console.error(`dimension mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  process.exit(1);
}
const diff = out ? new PNG({ width: a.width, height: a.height }) : null;
const changed = pixelmatch(a.data, b.data, diff?.data ?? null, a.width, a.height, { threshold: 0 });
if (diff) writeFileSync(out, PNG.sync.write(diff));

const pct = ((changed / (a.width * a.height)) * 100).toFixed(4);
console.log(`${changed} pixels differ (${pct}%)`);
process.exit(changed > threshold ? 1 : 0);
