/**
 * The client tests, plus the two that reach into the widget.
 *
 * `packages/avatar/src/` is the widget — dependency-free ES modules judged by
 * eye, not by a DOM
 * emulator (CLAUDE.md § Verifying). Two files here reach into it anyway, and
 * both are careful about what they claim: `mount.smoke.test.ts` proves the
 * *package boundary* (the subpath resolves, the modules load, the SVG lands in
 * the DOM), and `conformance.test.ts` proves the mixer's *numbers* stay finite
 * and in range across the whole vocabulary. Neither looks at a pixel, and
 * nothing here can tell you whether a face reads as THINKING or as asleep.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/avatar/test/**/*.test.ts"],
    environment: "node",
  },
});
