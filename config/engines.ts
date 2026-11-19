/**
 * The language engines, their versions and where they're served from. One source for the runner (app/run), the
 * fetch/build script (scripts/fetch-engines.mjs), the deploy (scripts/cloudflare-build.mjs) and the service worker.
 *
 * Every engine lives under /engines/<id>-<version>/, so a URL's content never changes: browsers and the service worker
 * cache them forever, and a new version is simply a new folder.
 */

export const ENGINES = {
  /** CPython compiled to WebAssembly with Emscripten. */
  pyodide: { version: "314.0.8", label: "Pyodide 314.0.8 (CPython 3.14)" },
  /** QuickJS (bundled with the app, ~1 MB): runs JavaScript, and TypeScript after Sucrase strips the types. */
  quickjs: { version: "0.32.0", label: "QuickJS (quickjs-emscripten 0.32)" },
  /** LLVM/Clang 22 + wasm-ld + wasi-libc + libc++, compiled to WebAssembly by YoWASP. */
  clang: { version: "22.0.0-git20695-13", label: "Clang 22 (YoWASP) → wasm32-wasip1" },
  /** Go's own compiler and linker (cmd/compile, cmd/link) built for wasip1, plus the standard library. */
  go: { version: "go1.27.0", label: "Go 1.27 gc toolchain → wasip1" },
  /** rustc with the LLVM backend, built for wasm32-wasip1-threads (oligamiq/rust_wasm), and the wasm32-wasip1 std. */
  rust: { version: "v0.2.1", label: "rustc 1.83.0-dev (LLVM) → wasm32-wasip1, linked by wasm-ld" },
  /** javac 25 and TeaVM in one WebAssembly GC module (konsoletyper/teavm-javac, teavm.org/playground build 3). */
  java: { version: "r3-7f3828e4", label: "javac 25 + TeaVM (teavm-javac) → WebAssembly GC" },
} as const;

export type EngineId = keyof typeof ENGINES;

export const engineBase = (id: EngineId) => `/engines/${id}-${ENGINES[id].version}`;

/** Engine files are immutable per version. */
export const ENGINE_CACHE = "public, max-age=31536000, immutable";
