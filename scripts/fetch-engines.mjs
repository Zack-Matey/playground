// Fetch and build the language engines into public/engines/<id>-<version>/ (see config/engines.ts).
//   node scripts/fetch-engines.mjs
// Everything is served from this site's own origin, so the strict CSP holds and running code never touches a third
// party. Idempotent: an engine folder that is already complete (has .complete) is skipped. Runs before dev and build.
//
//   pyodide  copied from node_modules/pyodide (CPython 3.14 core + stdlib; MPL-2.0)
//   clang    copied from node_modules/@yowasp/clang (LLVM/Clang/LLD + wasi-libc + libc++; Apache-2.0 WITH LLVM-exception)
//   go       built here: `go build cmd/compile cmd/link` for GOOS=wasip1, plus every std package compiled for wasip1
//            (BSD-3-Clause). GOTOOLCHAIN pins the exact Go release, which `go` downloads if it isn't installed.
//   rust     downloaded from github.com/oligamiq/rust_wasm releases: rustc for wasm32-wasip1-threads and the
//            wasm32-wasip1 standard library (MIT/Apache-2.0)
//   java     downloaded from teavm.org/playground (konsoletyper/teavm-javac; Apache-2.0, javac GPLv2 + Classpath
//            Exception): javac and TeaVM compiled into one WebAssembly GC module, with the class libraries each needs.
//            The build isn't versioned upstream, so each file is pinned by its SHA-256.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { ENGINES } from "../config/engines.ts";

const root = path.resolve(import.meta.dirname, "..");
const dest = (id) => path.join(root, "public", "engines", `${id}-${ENGINES[id].version}`);
const nm = (...p) => path.join(root, "node_modules", ...p);

async function engine(id, build) {
  const dir = dest(id);
  if (existsSync(path.join(dir, ".complete"))) return;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log(`  ${id} ${ENGINES[id].version}`);
  await build(dir);
  writeFileSync(path.join(dir, ".complete"), new Date().toISOString() + "\n");
}

async function download(url) {
  process.stdout.write(`    fetching ${url} … `);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  return buf;
}

const pkgVersion = (name) => JSON.parse(readFileSync(nm(name, "package.json"), "utf8")).version;
function expectVersion(id, pkg) {
  const v = pkgVersion(pkg);
  if (v !== ENGINES[id].version) throw new Error(`${pkg} is ${v} but config/engines.ts says ${ENGINES[id].version}. Update one of them.`);
}

console.log("playground engines:");

await engine("pyodide", (dir) => {
  expectVersion("pyodide", "pyodide");
  for (const f of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) copyFileSync(nm("pyodide", f), path.join(dir, f));
});

await engine("clang", (dir) => {
  expectVersion("clang", "@yowasp/clang");
  const gen = nm("@yowasp/clang", "gen");
  for (const f of readdirSync(gen)) copyFileSync(path.join(gen, f), path.join(dir, f));
});

await engine("go", (dir) => {
  const env = { ...process.env, GOTOOLCHAIN: ENGINES.go.version, GOOS: "wasip1", GOARCH: "wasm", CGO_ENABLED: "0", GOFLAGS: "" };
  const go = (...args) => execFileSync("go", args, { cwd: root, env, encoding: "utf8", maxBuffer: 64 << 20 });
  try {
    go("version");
  } catch {
    throw new Error("Building the Go engine needs a Go toolchain (https://go.dev/dl/). Install Go, then run this again.");
  }
  for (const tool of ["compile", "link"]) go("build", "-trimpath", "-ldflags=-s -w", "-o", path.join(dir, `${tool}.wasm`), `cmd/${tool}`);
  // Each std package's compiled archive, and its direct imports (the runner resolves what a program needs from these).
  const pkgs = {};
  for (const line of go("list", "-export", "-f", "{{if .Export}}{{.ImportPath}}|{{join .Imports \",\"}}|{{.Export}}{{end}}", "std").trim().split("\n")) {
    const [pkg, imports, archive] = line.split("|");
    pkgs[pkg] = imports ? imports.split(",") : [];
    const out = path.join(dir, "pkg", `${pkg}.a`);
    mkdirSync(path.dirname(out), { recursive: true });
    copyFileSync(archive, out);
  }
  writeFileSync(path.join(dir, "std.json"), JSON.stringify({ go: go("env", "GOVERSION").trim(), packages: pkgs }));
});

await engine("rust", async (dir) => {
  const base = `https://github.com/oligamiq/rust_wasm/releases/download/${ENGINES.rust.version}-release`;
  writeFileSync(path.join(dir, "rustc.wasm"), brotliDecompressSync(await download(`${base}/rustc_opt.wasm.br`)));
  writeFileSync(path.join(dir, "sysroot-wasm32-wasip1.tar"), brotliDecompressSync(await download(`${base}/wasm32-wasip1.tar.br`)));
});

await engine("java", async (dir) => {
  const files = {
    "compiler.wasm": "7f3828e4b7bddf5504dadebfc4016e40f4441e15ee0519071781813ba2ed3a4c",
    "compile-classlib-teavm.bin": "e80ae10423a39290c5f20b6bb6da34d21c3ad0a75cd8dbdda4998d2813045e15",
    "runtime-classlib-teavm.bin": "ea670e71967eda93828cb894c1741a8ed2e94b3422eb99cb9eccec0de67daaa8",
  };
  for (const [f, sha] of Object.entries(files)) {
    const buf = await download(`https://teavm.org/playground/3/${f}`);
    const got = createHash("sha256").update(buf).digest("hex");
    if (got !== sha) throw new Error(`${f}: SHA-256 is ${got}, expected ${sha}. Upstream changed; review it and update the pins and config/engines.ts.`);
    writeFileSync(path.join(dir, f), buf);
  }
});

console.log("  done");
