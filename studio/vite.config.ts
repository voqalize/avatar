import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const port = Number(process.env.AVATAR_STUDIO_PORT ?? 4173);

/**
 * Studio deliberately serves the existing demo directory as public assets.
 * This keeps the curated WAV/cue fixtures canonical rather than copying them
 * into a second authoring tool.
 */
export default defineConfig({
  publicDir: resolve(root, "demo"),
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    fs: { allow: [root] },
  },
  preview: { host: "127.0.0.1", port, strictPort: true },
});
