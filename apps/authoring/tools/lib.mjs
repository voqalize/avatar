/**
 * Shared plumbing for the headless render tools.
 *
 * Serves the repo root itself (no-store, like serve.py — heuristic caching has
 * burned this project before, and the tools must never screenshot a stale
 * module), owns one browser, and knows how to wait for a page that renders
 * synchronously after module load.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

// `apps/authoring/tools/` → the repo root, three up. The pages import
// `../../packages/avatar/src/*.js` by relative path, so the served root has to
// be the root and not this directory — same reason serve.py does it.
export const REPO_ROOT = normalize(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

/** Static file server over the repo root on an ephemeral port. */
export function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(REPO_ROOT, path));
      if (!file.startsWith(REPO_ROOT)) throw new Error('outside root');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store, must-revalidate',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, close: () => server.close() });
    });
  });
}

export function launchBrowser() {
  // Chrome's sandbox needs unprivileged user namespaces, which hosted CI
  // runners disable — so the workflow hands in `--no-sandbox` through the
  // environment rather than every local run giving up its sandbox too.
  const args = process.env.PUPPETEER_ARGS?.split(/\s+/).filter(Boolean) ?? [];
  return puppeteer.launch({ headless: 'shell', args });
}

/**
 * Open a url-path on a fresh page and wait until it has settled.
 *
 * Collects page errors and console errors; the caller decides whether they are
 * fatal. Settle means: module scripts ran, fonts are ready, and two rAF ticks
 * have passed — enough for pages that build their DOM synchronously on load.
 * `wait` may be a number of extra milliseconds or a JS expression to await.
 */
export async function openSettled(browser, port, urlPath, { width = 1280, height = 900, scale = 2, wait } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));

  const url = `http://127.0.0.1:${port}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  if (typeof wait === 'number') await new Promise((r) => setTimeout(r, wait));
  else if (typeof wait === 'string' && wait) await page.evaluate((expr) => eval(expr), wait);

  return { page, errors, url };
}

/** Screenshot the whole page (fullPage) or one element. */
export async function screenshot(page, out, selector) {
  if (selector) {
    const el = await page.$(selector);
    if (!el) throw new Error(`selector not found: ${selector}`);
    await el.screenshot({ path: out });
  } else {
    await page.screenshot({ path: out, fullPage: true });
  }
}
