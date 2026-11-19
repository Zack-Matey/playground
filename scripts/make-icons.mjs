// Render the app icons (PWA, Apple touch) from public/favicon.svg: the orange square with the play button.
//   node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const inner = readFileSync(path.join(root, "public/favicon.svg"), "utf8").replace(/^<svg[^>]*>|<\/svg>\s*$/g, "");
// `pad` shrinks the mark inside a dark tile (maskable icons need a safe zone); pad 0 = the bare square.
const tile = (size, pad) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" fill="#111010"/><g transform="translate(${pad} ${pad}) scale(${(64 - 2 * pad) / 64})">${inner}</g></svg>`;
mkdirSync(path.join(root, "public/icons"), { recursive: true });
for (const [name, size, pad] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["maskable-512.png", 512, 12], ["apple-touch-icon.png", 180, 0]])
  await sharp(Buffer.from(tile(size, pad))).png().toFile(path.join(root, "public/icons", name));
console.log("icons ok");
