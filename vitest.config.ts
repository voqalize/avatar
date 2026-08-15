/**
 * The client tests only. `src/` is the widget — dependency-free ES modules
 * judged in a real browser by `authoring/tools/sweep.mjs` and by eye (CLAUDE.md §
 * Verifying), not by a DOM emulator. The one exception is
 * `client/test/mount.smoke.test.ts`, which proves the package boundary rather
 * than the rig.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["client/test/**/*.test.ts"],
    environment: "node",
  },
});
