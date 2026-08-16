#!/usr/bin/env node
/**
 * Render one page headless and write a PNG.
 *
 *   node apps/authoring/tools/shot.mjs 'apps/authoring/contact-sheet.html?face=peep' -o /tmp/peep.png
 *   node apps/authoring/tools/shot.mjs 'apps/authoring/clip-strip.html?clip=SHRUG' --selector '#g'
 *   node apps/authoring/tools/shot.mjs index.html --wait 500          # extra settle ms
 *   node apps/authoring/tools/shot.mjs page.html --wait 'window.done' # await an expression
 *
 * Serves the repo itself (no serve.py needed), waits for module scripts +
 * fonts + two rAF ticks, and fails (exit 1) on any page error, console.error
 * or failed request — a screenshot of a broken page is worse than no
 * screenshot, because it looks like evidence.
 */
import { startServer, launchBrowser, openSettled, screenshot } from './lib.mjs';

const args = process.argv.slice(2);
const urlPath = args.find((a) => !a.startsWith('-'));
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
if (!urlPath) {
  console.error('usage: node apps/authoring/tools/shot.mjs <url-path> [-o out.png] [--selector css] [--width N] [--scale N] [--wait ms|expr]');
  process.exit(2);
}
const out = opt('-o', 'shot.png');
const selector = opt('--selector');
const width = Number(opt('--width', 1280));
const scale = Number(opt('--scale', 2));
const waitRaw = opt('--wait');
const wait = waitRaw === undefined ? undefined : (/^\d+$/.test(waitRaw) ? Number(waitRaw) : waitRaw);

const server = await startServer();
const browser = await launchBrowser();
try {
  const { page, errors, url } = await openSettled(browser, server.port, urlPath, { width, scale, wait });
  if (errors.length) {
    console.error(`page had errors — refusing to screenshot ${url}`);
    for (const e of errors) console.error('  ' + e);
    process.exit(1);
  }
  await screenshot(page, out, selector);
  console.log(out);
} finally {
  await browser.close();
  server.close();
}
