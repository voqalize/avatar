import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
/** `apps/studio/` → the repo root, two up. */
const root = resolve(here, "..", "..");
/** Where `apps/server/` is listening; pm2 supplies it. */
const api = process.env.AVATAR_SERVER_URL ?? "http://localhost:7860";

/**
 * Studio is a client of `apps/server/`, not a second server.
 *
 * `/api` is proxied rather than pointed at by absolute URL so the page is
 * same-origin: `POST /api/offer` carries an SDP offer and the control plane
 * carries none of its own CORS story, and adding one to `apps/server/` for the
 * sake of a dev tool would be a production concern invented by tooling.
 *
 * `fs.allow` reaches the repo root because `@voqalize/avatar` is a workspace
 * link into `packages/avatar`, and its `dist/*.js` imports `../src/*.js` by
 * relative path — the package is deliberately unbundled and vite serves it
 * as-is, out of a directory the studio root does not contain.
 *
 * The proxy target is also handed to the page as a constant, because the one
 * message that has to name it — "nothing is listening, start it like this" —
 * is otherwise a second copy of it that can go stale against an
 * `AVATAR_SERVER_URL` override.
 */
export default defineConfig({
  define: { "import.meta.env.VITE_AVATAR_SERVER_URL": JSON.stringify(api) },
  server: {
    host: "127.0.0.1",
    // Vite rejects unknown Host headers; allow the local nginx front.
    allowedHosts: [".local.voqalize.com"],
    fs: { allow: [root] },
    proxy: { "/api": { target: api, changeOrigin: false } },
  },
  preview: {
    host: "127.0.0.1",
    allowedHosts: [".local.voqalize.com"],
  },
});
