import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest configuration.
 *
 * The suite lives in the repo-root `tests/frontend/` directory (per the repo
 * layout rules), so those files are whitelisted through `server.fs.allow` (the
 * working directory stays `src/frontend`, which hosts the node_modules).
 * Coverage is measured over the pure logic modules only (DOM glue is exercised
 * by e2e) with the project-mandated 90% thresholds.
 */
export default defineConfig({
  test: {
    include: ["../../tests/frontend/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/overlay/state.ts", "src/overlay/geometry.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
  server: {
    fs: {
      allow: [resolve(__dirname, "../..")],
      strict: false,
    },
  },
});
