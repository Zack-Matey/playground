# Playground

Run code snippets in the browser at **[playground.zackmatey.com](https://playground.zackmatey.com)**: Python, JavaScript, TypeScript, C, C++, Go, Rust and Java. Part of [zackmatey.com](https://zackmatey.com), and built with the same stack (Next.js static export, Tailwind, Cloudflare Workers static assets + R2).

Every interpreter and compiler is compiled to **WebAssembly** and runs on the visitor's device, in a Web Worker. Nothing runs code on a server: the site and the engines are static files served from Cloudflare's edge.

| Language | Engine | Pipeline |
|---|---|---|
| Python | Pyodide 314 (CPython 3.14) | interpreted in wasm |
| JavaScript | QuickJS (quickjs-emscripten) | interpreted in wasm, as an ES module |
| TypeScript | Sucrase + QuickJS | types stripped, then as JavaScript |
| C / C++ | YoWASP Clang 22, wasi-libc, libc++ | clang → wasm-ld → `wasm32-wasip1` program → our WASI host |
| Go | Go 1.27's own `cmd/compile` + `cmd/link`, built for `GOOS=wasip1` | compile → link → `wasip1` program → our WASI host |
| Rust (experimental) | rustc 1.83 (LLVM) for `wasm32-wasip1-threads`, from [oligamiq/rust_wasm](https://github.com/oligamiq/rust_wasm) | rustc (threaded) → wasm-ld (from the Clang engine) → our WASI host |
| Java (experimental) | javac 25 + TeaVM in one WebAssembly GC module, from [teavm-javac](https://github.com/konsoletyper/teavm-javac) | javac → TeaVM → WebAssembly GC program, run with our CSP-safe TeaVM loader |

## Run it

```sh
npm install
npm run dev          # http://localhost:3000 (fetches/builds the engines first)
npm test             # unit tests (vitest)
npm run typecheck
npm run e2e -- http://localhost:3000   # real programs in every language, in headless Chrome
```

`npm run fetch-engines` (also run before `dev` and `build`) fills `public/engines/<id>-<version>/`:

- **pyodide**, **clang**: copied from `node_modules`.
- **go**: built locally. It needs a Go toolchain; `GOTOOLCHAIN` pins the exact release from `config/engines.ts`, which `go` downloads if needed. It builds the compiler and linker for wasip1 and copies every std package's archive plus `std.json` (each package's imports, so the runner downloads only what a program needs).
- **rust**: downloaded from the rust_wasm GitHub release.
- **java**: downloaded from teavm.org/playground (build 3; upstream doesn't version it, so each file is pinned by SHA-256 and the version in `config/engines.ts` names the build and the compiler's hash).

About 550 MB on disk; brotli brings a first run down to roughly 6 MB (Python), 20 MB (C/C++), 14 MB (Go) and 60 MB (Rust, including wasm-ld) and 4 MB (Java).

## Deploy (Cloudflare)

A static export, like zackmatey.com, with no server to run or pay for:

- **Pages**: `next build` with `EXPORT=1` writes plain HTML/JS to `out/`, served by Workers static assets.
- **Engines**: too big for static assets (25 MiB per file, and they compress 3-5x), so the build brotli-compresses them (quality 11) into `out-large/` and they live in an R2 bucket (`playground-engines`). `worker/index.ts` streams them back with `Content-Encoding: br` (`encodeBody: "manual"`), so it spends no CPU on them. Only `/engines/*` runs the Worker.
- **Headers**: `out/_headers` gets the same headers as the dev server, from `config/security.ts`: the CSP, and COOP/COEP for cross-origin isolation (needed for SharedArrayBuffer, which the threaded Rust compiler uses).

One-time setup (the `zackmatey.com` zone must be in the same Cloudflare account):

```sh
npx wrangler login
npx wrangler r2 bucket create playground-engines
```

Then each deploy:

```sh
npm run cf:deploy    # build to out/, upload new/changed engine files to R2, wrangler deploy
```

`worker/r2-uploaded.json` records what's in the bucket (by SHA-256), so unchanged engines aren't recompressed or re-uploaded. Commit it after deploys. The first upload sends ~430 files one `wrangler r2 object put` at a time, which takes a while; later deploys only send what changed (engine paths are versioned, so a new version is new files).

To try the Cloudflare build locally first: `npm run cf:dev` (`wrangler dev` with a local R2 copy) at http://localhost:8787.

In the Cloudflare dashboard, keep features that inject scripts switched off for this hostname: Rocket Loader, Email Address Obfuscation and automatic Web Analytics. The CSP blocks injected scripts (and COEP blocks cross-origin ones).

## Layout

| Path | What |
|---|---|
| `config/engines.ts` | Engine ids, versions and labels; engines are served from `/engines/<id>-<version>/` |
| `config/security.ts` | CSP, COOP/COEP and other headers, shared by Next.js and the Cloudflare `_headers` file |
| `app/lib/languages.ts` | Every language: page, file name, engine, examples |
| `app/components/playground.tsx` | The editor/output/stdin page; `editor.tsx` is CodeMirror 6 |
| `app/run/client.ts` | Page side: one warm runner worker per language; Stop terminates it. Also `window.playground.run()` |
| `app/run/runner.worker.ts` | The runner worker: dispatches to a language runner, batches output |
| `app/run/langs/*.ts` | Language runners (python, js/ts, clang, go, rust, java); `teavm.ts` loads TeaVM modules without eval, `teavm-jsbody.ts` holds the few JS snippets TeaVM itself needs |
| `app/run/wasi/` | Our WASI preview 1 host: in-memory fs, syscalls, and threads (`threads.ts` + `thread.worker.ts`) |
| `worker/index.ts`, `wrangler.jsonc` | The Cloudflare Worker that serves engines from R2 |
| `scripts/fetch-engines.mjs` | Fetch/build engines into `public/engines/` |
| `scripts/cloudflare-build.mjs`, `scripts/cloudflare-deploy.mjs` | Static export, engine compression, R2 upload, deploy |
| `public/sw.js` | Service worker: engines and build assets cache-first, pages network-first |

### Adding a language

1. Add the engine to `config/engines.ts` and fetch/build it in `scripts/fetch-engines.mjs`.
2. Write `app/run/langs/<lang>.ts` exporting a `Runner` (load the engine with `fetchModule`/`fetchBytes`, report phases, write output through `ctx`). Compiled languages can emit a `wasm32-wasip1` program and call `runProgram`.
3. Add it to `LANGUAGES` (`app/lib/languages.ts`), `RUNNERS` (`runner.worker.ts`), an icon (`language-icons.tsx`) and a CodeMirror mode (`editor.tsx`).
4. Add cases to `test/e2e/run.mjs`.

## Design decisions

- **Real toolchains, not lookalikes.** Go uses the gc compiler and linker themselves, Rust uses rustc with LLVM, C/C++ use Clang. Errors, warnings and behavior match what you'd get locally.
- **The browser is the sandbox.** Programs run in WebAssembly inside a Web Worker. JavaScript runs in QuickJS (wasm), not the page's engine, so snippets can't reach the DOM, storage or network. The CSP (`connect-src 'self'`) is the outer wall, and no `unsafe-eval` is allowed in production.
- **Our own WASI host** (`app/run/wasi/`) over an in-memory filesystem, used by the Go toolchain, rustc and every compiled program. Threads (for rustc) run one Worker per wasm thread on a shared memory. The host worker owns the filesystem and is never blocked, so it answers syscalls and spawns threads; signalling uses `postMessage` + `Atomics.wait`, not `Atomics.waitAsync`, so it works in every browser with SharedArrayBuffer.
- **Linking Rust without subprocesses.** rustc can't spawn a linker under WASI, so it runs with `--print link-args -C save-temps`, and we hand that exact command to wasm-ld from the Clang engine. This rustc is built with `panic=abort`, so it ends a failed compile by trapping after printing its errors; the runner treats that as exit 1.
- **Java without eval.** TeaVM's own JS glue builds its interop helpers with `new Function`, which the CSP forbids, so `app/run/langs/teavm.ts` is a port of it that uses closures instead. The one real use of JS source, `@JSBody`, is resolved from a fixed table of the snippets the compiler and TeaVM's class library contain; any other snippet (a user's own `@JSBody`) is refused, so Java programs only ever run as WebAssembly. A generated launcher wraps `main` so uncaught exceptions print as the JVM prints them. Known gaps in this TeaVM build: no stdin, no `System.exit`, floating-point formatting (`%f`, `DecimalFormat`) fails, and null/bounds/zero-division errors are WebAssembly traps that Java can't catch. `node scripts/dev/teavm-probe.mjs File.java` drives the engine from Node.
- **Engines are immutable per version**, so they're cached forever by browsers and the service worker, and a version bump is just a new folder.
