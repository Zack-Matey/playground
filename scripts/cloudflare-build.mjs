// Build the static site for Cloudflare.
//   node scripts/cloudflare-build.mjs [--local]
// 1. Fetches/builds the engines (scripts/fetch-engines.mjs) and runs `next build` as a static export into out/.
// 2. Writes out/_headers with the same security headers the dev server sends (config/security.ts), including the
//    COOP/COEP pair that makes the site cross-origin isolated.
// 3. Moves out/engines/ out of the static assets: every engine file is listed in worker/engines.json (path, type,
//    SHA-256) and, unless that exact file is already in R2 (worker/r2-uploaded.json, kept by the deploy script), brotli-compressed into
//    out-large/ for scripts/cloudflare-deploy.mjs to upload. --local compresses everything (for wrangler dev's local R2).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
import { securityHeaders, workerSecurityHeaders } from "../config/security.ts";
import { ENGINE_CACHE } from "../config/engines.ts";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "out");
const large = path.join(root, "out-large");
const local = process.argv.includes("--local");
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

run(process.execPath, ["scripts/fetch-engines.mjs"]);
rmSync(out, { recursive: true, force: true });
rmSync(large, { recursive: true, force: true });
run(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build"], { EXPORT: "1", NEXT_DIST_DIR: "out", NEXT_TELEMETRY_DISABLED: "1" });
for (const junk of ["cache", "trace", "types"]) rmSync(path.join(out, junk), { recursive: true, force: true });

// ---------- _headers ----------
const block = (pattern, headers) => `${pattern}\n${headers.map(({ key, value }) => `  ${key}: ${value}`).join("\n")}\n`;
writeFileSync(
  path.join(out, "_headers"),
  [
    block("/*", securityHeaders(false)),
    // Cloudflare joins a header set by two matching rules with a comma: two CSPs, both enforced (see config/security.ts).
    block("/_next/static/*", [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }, ...workerSecurityHeaders(false)]),
    block("/sw.js", [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }]),
  ].join("\n"),
);

// ---------- engines → R2 ----------
const TYPES = { ".wasm": "application/wasm", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".zip": "application/zip", ".tar": "application/x-tar" };
const uploaded = existsSync(path.join(root, "worker/r2-uploaded.json")) ? JSON.parse(readFileSync(path.join(root, "worker/r2-uploaded.json"), "utf8")) : {};
const engines = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name !== ".complete") engines.push(p);
  }
};
walk(path.join(out, "engines"));
const compress = promisify(brotliCompress);
const files = [];
let raw = 0, packed = 0, todo = 0;
// A few at a time: zlib runs on the libuv thread pool.
const queue = [...engines];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let p; (p = queue.shift()); ) {
      const rel = path.relative(out, p).split(path.sep).join("/");
      const data = readFileSync(p);
      const sha256 = createHash("sha256").update(data).digest("hex");
      files.push({ path: `/${rel}`, contentType: TYPES[path.extname(p)] ?? "application/octet-stream", sha256 });
      raw += data.length;
      if (!local && uploaded[rel] === sha256) continue;
      const br = await compress(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
      mkdirSync(path.dirname(path.join(large, rel)), { recursive: true });
      writeFileSync(path.join(large, rel), br);
      packed += br.length;
      todo++;
      if (todo % 50 === 0 || data.length > 5e6) console.log(`  compressed ${rel}: ${(data.length / 1048576).toFixed(1)} → ${(br.length / 1048576).toFixed(1)} MiB`);
    }
  }),
);
rmSync(path.join(out, "engines"), { recursive: true, force: true });
files.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(path.join(root, "worker/engines.json"), JSON.stringify(files, null, 1) + "\n");

let count = 0;
const countFiles = (dir) => readdirSync(dir).forEach((n) => (statSync(path.join(dir, n)).isDirectory() ? countFiles(path.join(dir, n)) : count++));
countFiles(out);
if (count > 20000) throw new Error(`${count} static files: over Workers' 20,000-file limit.`);
console.log(`\nout/: ${count} static files. Engines: ${files.length} files, ${(raw / 1048576).toFixed(0)} MiB; ${todo} to upload (${(packed / 1048576).toFixed(0)} MiB brotli) in out-large/.`);
console.log(`Engine responses are sent with Cache-Control: ${ENGINE_CACHE}`);
