#!/usr/bin/env node
/**
 * Render the standard verification set for every registered avatar.
 *
 *   node tools/baseline.mjs [outDir]        # default .review/baseline-<sha>/
 *
 * Per avatar: the contact sheet, the torso sheet, and clip filmstrips for
 * NOD_SMALL (fast, smoothing-dominated) and SHRUG (multi-channel, held).
 * Only deterministic pages are included — these all render via direct
 * `apply()` or fixed-tick ClipPlayer stepping, no live mixer, no randomness —
 * so two baselines from the same tree must be pixel-identical, and
 * `tools/diff.mjs` between baselines is a real refactor-safety check.
 *
 * The avatar list is scraped from the registry through the served page, so a
 * newly registered avatar joins the baseline without touching this file.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, launchBrowser, openSettled, screenshot, REPO_ROOT } from './lib.mjs';

const sha = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim();
const outDir = process.argv[2] || join(REPO_ROOT, '.review', `baseline-${sha}`);
mkdirSync(outDir, { recursive: true });

const CLIPS = ['NOD_SMALL', 'SHRUG'];

const server = await startServer();
const browser = await launchBrowser();
try {
  // Ask the face table itself which faces exist.
  const probe = await openSettled(browser, server.port, 'demo/rig/index.html');
  const names = await probe.page.evaluate(async () => {
    const mod = await import('/src/faces.js');
    return mod.FACE_NAMES;
  });
  await probe.page.close();

  const jobs = [];
  for (const name of names) {
    jobs.push([`${name}-contact-sheet.png`, `demo/rig/contact-sheet.html?face=${name}`]);
    jobs.push([`${name}-torso-check.png`, `demo/rig/torso-check.html?face=${name}`]);
    for (const clip of CLIPS) {
      jobs.push([`${name}-clip-${clip}.png`, `demo/rig/clip-strip.html?face=${name}&clip=${clip}`]);
    }
  }

  let failed = 0;
  for (const [file, urlPath] of jobs) {
    const { page, errors } = await openSettled(browser, server.port, urlPath);
    if (errors.length) {
      failed++;
      console.error(`FAIL ${urlPath}`);
      for (const e of errors) console.error('  ' + e);
    } else {
      await screenshot(page, join(outDir, file));
      console.log(`ok   ${file}`);
    }
    await page.close();
  }
  console.log(`\n${jobs.length - failed}/${jobs.length} rendered into ${outDir}`);
  if (failed) process.exit(1);
} finally {
  await browser.close();
  server.close();
}
