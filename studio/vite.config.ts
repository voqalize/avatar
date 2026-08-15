import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const port = Number(process.env.AVATAR_STUDIO_PORT ?? 4173);
/** Where `server/server.py` binds by default. */
const api = process.env.AVATAR_SERVER_URL ?? "http://localhost:7860";

/**
 * Studio is a client of `server/`, not a second server.
 *
 * `/api` is proxied rather than pointed at by absolute URL so the page is
 * same-origin: `POST /api/offer` carries an SDP offer and the control plane
 * carries none of its own CORS story, and adding one to `server/` for the sake
 * of a dev tool would be a production concern invented by tooling.
 *
 * `fs.allow` reaches the repo root because `@voqalize/avatar` resolves to
 * `client/dist/*.js`, which imports `../../src/*.js` by relative path — the
 * package is deliberately unbundled and vite serves it as-is.
 */
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    fs: { allow: [root] },
    proxy: { "/api": { target: api, changeOrigin: false } },
  },
  preview: { host: "127.0.0.1", port, strictPort: true },
});
