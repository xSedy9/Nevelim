import { defineConfig } from "vite";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

/**
 * Vite configuration: four HTML entries (overlay, modal, settings, import)
 * sharing one bundle, plus the Vitest test/coverage setup.
 */
export default defineConfig({
  base: "./",
  clearScreen: false,
  build: {
    target: "safari16",
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, "overlay.html"),
        modal: resolve(__dirname, "modal.html"),
        settings: resolve(__dirname, "settings.html"),
        import: resolve(__dirname, "import.html"),
      },
    },
  },
  test: {
    coverage: {
      provider: "v8",
      // The repo may live on a network drive where the v8 provider cannot
      // create its temp dir; keep coverage artifacts on the local disk.
      reportsDirectory: resolve(tmpdir(), "quick-snippets-coverage"),
      // Logic modules must stay above the 90% line; the window entries
      // (src/<window>/main.ts) are thin Tauri/DOM wiring verified by the
      // e2e smoke suite instead.
      include: ["src/**/*.ts"],
      exclude: ["src/overlay/main.ts", "src/modal/main.ts", "src/settings/main.ts", "src/import/main.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 90,
      },
    },
  },
});
