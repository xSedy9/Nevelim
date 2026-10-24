/**
 * End-to-end smoke tests: run after `npm run build` (src/frontend).
 *
 * Validates, without launching the desktop app:
 * 1. every HTML entry was emitted to dist/;
 * 2. every local asset referenced by those entries exists in dist/;
 * 3. the IPC contract holds — every `invoke("...")` command used by the
 *    frontend is registered in the Tauri invoke handler (desktop crate).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const frontend = join(root, "src", "frontend");
const dist = join(frontend, "dist");
const entries = ["overlay.html", "modal.html", "settings.html", "import.html"];

let failures = 0;

/** Reports one assertion result. */
function check(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}

// 1. Built entries exist.
for (const entry of entries) {
  check(existsSync(join(dist, entry)), `dist/${entry} exists`);
}

// 2. Every local asset reference resolves inside dist.
for (const entry of entries) {
  const htmlPath = join(dist, entry);
  if (!existsSync(htmlPath)) continue;
  const html = readFileSync(htmlPath, "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => !url.startsWith("http") && !url.startsWith("data:"));
  for (const ref of refs) {
    const asset = join(dist, ref.replace(/^\//, ""));
    check(existsSync(asset), `${entry} -> ${ref}`);
  }
}

// 3. IPC contract: frontend commands are all registered on the Rust side.
const ipc = readFileSync(join(frontend, "src", "shared", "ipc.ts"), "utf8");
const usedCommands = new Set(
  [...ipc.matchAll(/invoke\(\s*"([a-z_]+)"/g)].map((m) => m[1]),
);
const lib = readFileSync(join(root, "src", "desktop", "src", "lib.rs"), "utf8");
const registeredCommands = new Set(
  [...lib.matchAll(/commands::([a-z_]+)/g)].map((m) => m[1]),
);
for (const command of usedCommands) {
  check(registeredCommands.has(command), `command '${command}' is registered`);
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke checks passed");
