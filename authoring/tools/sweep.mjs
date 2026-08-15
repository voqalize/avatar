#!/usr/bin/env node
/**
 * Run the rig-check conformance sweep headless.
 *
 *   node authoring/tools/sweep.mjs
 *
 * Loads authoring/rig-check.html, runs `await sweep()` (every state, emotion,
 * gaze and interjection on every registered avatar, then a viseme track;
 * asserts finite in-range params and attached SVGs), prints the result and
 * exits non-zero on failure. This is the pre-commit gate for anything that
 * touches src/.
 */
import { startServer, launchBrowser, openSettled } from './lib.mjs';

const server = await startServer();
const browser = await launchBrowser();
try {
  const { page, errors } = await openSettled(browser, server.port, 'authoring/rig-check.html');
  if (errors.length) {
    console.error('rig-check failed to load cleanly:');
    for (const e of errors) console.error('  ' + e);
    process.exit(1);
  }
  const result = await page.evaluate(() => window.sweep());
  if (result.ok) {
    console.log('sweep passed');
  } else {
    console.error(`sweep FAILED — ${result.problems.length} problems:`);
    for (const p of result.problems.slice(0, 60)) console.error('  ' + p);
    process.exit(1);
  }
} finally {
  await browser.close();
  server.close();
}
