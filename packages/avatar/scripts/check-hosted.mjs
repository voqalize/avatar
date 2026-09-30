#!/usr/bin/env node
/**
 * Is everything this shim will load actually served? Run before `npm publish`,
 * and it refuses the publish if not.
 *
 * A shim names one runtime by URL (`shim/pin.ts`), and that runtime names its
 * characters' GLBs by URL. Publish a shim whose runtime is not on the host, or
 * whose runtime names a GLB that is not, and every customer who installs it
 * gets an avatar that never appears. Nothing but the host can say so, and
 * after the publish it is too late, because npm versions cannot be reused.
 *
 * So this asks the host, from outside, what a customer's browser will ask:
 *
 *   - the runtime at the pinned URL: 200, JavaScript, open CORS;
 *   - every `characters/<name>.<hash>.glb` (and `<name>-still.<hash>.webp`,
 *     `<name>-mouth.<hash>.json`) the runtime's text names, resolved
 *     against the runtime's URL the way the runtime resolves it: 200, open CORS;
 *   - and every `.glb` and `.json` sealed: the host serves the runtime's own
 *     format and never a glTF file or readable JSON, so each must begin `VQAV`;
 *   - `/LICENSE` and `/NOTICE`, which the runtime's banner and every GLB's
 *     copyright field point at: 200.
 *
 * It reads the GLB names out of the runtime rather than from a build's output
 * directory, so it needs nothing but the pin and the network, and runs the
 * same in private before the export as in public before the publish.
 *
 *   node packages/avatar/scripts/check-hosted.mjs              # the pin in shim/pin.ts
 *   node packages/avatar/scripts/check-hosted.mjs --production # ...and it must be avatar.voqalize.com
 *   node packages/avatar/scripts/check-hosted.mjs <runtime-url>
 *
 * No dependencies: it runs in the public checkout's release job with nothing
 * installed.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const PRODUCTION = "https://avatar.voqalize.com";

/** Every hosted character file the runtime's text names, as written there. */
export function namedCharacters(runtimeText) {
  return [...new Set(runtimeText.match(/characters\/[a-z0-9_-]+\.[0-9a-f]{12}\.(?:glb|webp|json)/g) ?? [])].sort();
}

/**
 * Check the runtime at `runtimeUrl` and everything it names. Returns one row
 * per URL, `{ url, ok, why }`, and never throws for a bad host: a network error
 * is a row that is not ok.
 */
export async function checkHosted(runtimeUrl, { fetch: get = fetch } = {}) {
  const rows = [];
  const ask = async (url, want) => {
    try {
      const res = await get(url, { headers: { Origin: "https://example.com" } });
      const why = [];
      if (res.status !== 200) why.push(`${res.status}`);
      if (want.cors && res.headers.get("access-control-allow-origin") !== "*") {
        why.push(`Access-Control-Allow-Origin ${res.headers.get("access-control-allow-origin") ?? "missing"}`);
      }
      if (want.type && !want.type.test(res.headers.get("content-type") ?? "")) {
        why.push(`Content-Type ${res.headers.get("content-type") ?? "missing"}`);
      }
      const text = want.body && res.status === 200 ? await res.text() : null;
      if (want.sealed && res.status === 200) {
        const head = new Uint8Array(await res.arrayBuffer()).subarray(0, 4);
        if (String.fromCharCode(...head) !== "VQAV") why.push("not a sealed file");
      } else if (!want.body) await res.body?.cancel();
      rows.push({ url, ok: why.length === 0, why: why.join(", ") });
      return text;
    } catch (err) {
      rows.push({ url, ok: false, why: err.cause?.code ?? err.message });
      return null;
    }
  };

  const runtime = await ask(runtimeUrl, { cors: true, type: /javascript/, body: true });
  if (runtime !== null) {
    const glbs = namedCharacters(runtime);
    if (glbs.length === 0) rows.push({ url: runtimeUrl, ok: false, why: "names no character" });
    // `../` because the runtime lives in `runtime/` and the GLBs beside it
    // (scripts/build-runtime.mjs).
    // A GLB and a mouth chart are both sealed; only the still is served as it is.
    for (const glb of glbs) await ask(new URL(`../${glb}`, runtimeUrl).href, { cors: true, sealed: !glb.endsWith(".webp") });
  }
  for (const name of ["LICENSE", "NOTICE"]) await ask(new URL(`/${name}`, runtimeUrl).href, {});
  return rows;
}

/** The runtime URL a shim is released with, read from `shim/pin.ts`. */
export async function pinnedRuntime() {
  const pin = await readFile(new URL("../shim/pin.ts", import.meta.url), "utf8");
  const [, url] = pin.match(/export const RUNTIME_URL = "([^"]+)";/) ?? [];
  if (!url) throw new Error("shim/pin.ts: no `export const RUNTIME_URL = \"...\";`");
  return url;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const production = args.includes("--production");
  const url = args.find((a) => !a.startsWith("--")) ?? (await pinnedRuntime());
  if (production && new URL(url).origin !== PRODUCTION) {
    console.error(`! the pin names ${new URL(url).origin}, not ${PRODUCTION}.`);
    console.error("  A shim released against any other host breaks for every customer; rebuild the runtime");
    console.error("  without RUNTIME_BASE and commit the pin it writes.");
    process.exit(1);
  }
  const rows = await checkHosted(url);
  for (const { url: u, ok, why } of rows) console.log(`${ok ? "ok  " : "FAIL"}  ${u}${why ? `  (${why})` : ""}`);
  if (rows.some((r) => !r.ok)) {
    console.error("\n! not everything this shim loads is served. Upload first (scripts/upload-runtime.mjs); do not publish.");
    process.exit(1);
  }
  console.log("\neverything this shim loads is served.");
}
