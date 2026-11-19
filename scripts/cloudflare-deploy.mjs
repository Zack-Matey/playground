// Deploy to Cloudflare (run scripts/cloudflare-build.mjs first; `npm run cf:deploy` does both).
//   node scripts/cloudflare-deploy.mjs [--local]
// Uploads the compressed engine files in out-large/ to the R2 bucket, then runs `wrangler deploy`.
// worker/r2-uploaded.json records the SHA-256 of what's in the bucket (commit it), so unchanged engines aren't re-sent.
// --local fills wrangler's local R2 instead and skips the deploy, for testing with `npx wrangler dev`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const local = process.argv.includes("--local");
const BUCKET = "playground-engines";
const wrangler = (args) => execFileSync(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), ...args], { cwd: root, stdio: "inherit" });

const files = JSON.parse(readFileSync(path.join(root, "worker/engines.json"), "utf8"));
if (!files.length || !existsSync(path.join(root, "out/index.html"))) throw new Error("Nothing built. Run `node scripts/cloudflare-build.mjs` first.");

const stateFile = path.join(root, local ? ".wrangler/r2-uploaded.local.json" : "worker/r2-uploaded.json");
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
let sent = 0;
for (const f of files) {
  const key = f.path.slice(1);
  if (state[key] === f.sha256) continue;
  const src = path.join(root, "out-large", key);
  if (!existsSync(src)) throw new Error(`${key} changed but out-large/ has no compressed copy. Rebuild${local ? " with --local" : ""}.`);
  wrangler(["r2", "object", "put", `${BUCKET}/${key}`, `--file=${src}`, `--content-type=${f.contentType}`, local ? "--local" : "--remote"]);
  state[key] = f.sha256;
  writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  sent++;
}
console.log(`${sent} engine files uploaded${local ? " to local R2" : ""}.`);
if (local) console.log("Local R2 is ready. Start the site with: npx wrangler dev");
else wrangler(["deploy"]);
