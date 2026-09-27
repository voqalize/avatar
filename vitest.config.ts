/**
 * The shim's tests. The runtime it loads is built and tested where it is
 * developed; nothing of it is in this tree.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/avatar/test/**/*.test.ts"],
    environment: "node",
  },
});
