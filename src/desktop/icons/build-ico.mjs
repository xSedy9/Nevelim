/**
 * Packs icon.ico with PNG layers ordered from LARGEST to smallest.
 *
 * Windows picks the FIRST layer of an .ico for the window/taskbar icon, so
 * the descending order guarantees the sharpest image is used. Run after
 * `npx tauri icon ...` (which emits the individual PNG sizes):
 *
 *   node src/desktop/icons/build-ico.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

// Descending: the first entry is what Windows prefers.
const layers = [
  { file: "128x128@2x.png", size: 256 },
  { file: "128x128.png", size: 128 },
  { file: "64x64.png", size: 64 },
  { file: "32x32.png", size: 32 },
];

const images = layers.map(({ file, size }) => ({
  size,
  data: readFileSync(join(dir, file)),
}));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + 16 * images.length;
const entries = [];
for (const { size, data } of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
  entry.writeUInt8(0, 2); // palette size
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  entries.push(entry);
}

writeFileSync(
  join(dir, "icon.ico"),
  Buffer.concat([header, ...entries, ...images.map((i) => i.data)]),
);
console.log(
  `icon.ico written: ${images.length} layers, descending [${images
    .map((i) => i.size)
    .join(" -> ")}]`,
);
