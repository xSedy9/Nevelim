import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Vite configuration: two HTML entries (overlay + modal) sharing one bundle.
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
      },
    },
  },
});
