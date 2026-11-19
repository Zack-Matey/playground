/**
 * Rust: rustc (LLVM backend) compiled for wasm32-wasip1-threads by oligamiq/rust_wasm, with the prebuilt
 * wasm32-wasip1 standard library. rustc can't start a linker under WASI (there are no subprocesses), so we let it
 * print the exact link command (`--print link-args`), keep its object files (`-C save-temps`), and run that command
 * ourselves with wasm-ld from the Clang engine. The program then runs on our WASI host like any other.
 *
 * rustc always runs the compiler on a spawned thread, so it needs real threads: see ../wasi/threads.ts.
 */
import { type DirNode, dir, lookup, mountTar, parts, put, type Node } from "../wasi/fs";
import { runThreaded } from "../wasi/threads";
import { engineUrl, fetchBytes, fetchModule } from "../load";
import { loadClang, runProgram, yowasp } from "./clang";
import { dec, enc, err, type Runner } from "./ctx";

const TARGET = "wasm32-wasip1";
// rustc's declared memory import: 399 pages minimum, 1 GiB maximum (shared).
const RUSTC_MEMORY = { initial: 399, maximum: 16384 };

let sysroot: Promise<DirNode> | null = null;

/** Split rustc's printed link command (`"arg" "arg" …`, possibly preceded by VAR="value" pairs). */
export function parseLinkArgs(printed: string): string[] | null {
  for (const line of printed.split("\n")) {
    const toks = [...line.matchAll(/(?:([A-Za-z_][A-Za-z0-9_]*)=)?"((?:[^"\\]|\\.)*)"/g)].filter((m) => !m[1]).map((m) => m[2].replace(/\\(.)/g, "$1"));
    const at = toks.findIndex((t) => /(^|\/)(rust-lld|wasm-ld|lld)(\.exe)?$/.test(t));
    if (at < 0) continue;
    const args = toks.slice(at + 1);
    const f = args.indexOf("-flavor");
    if (f >= 0) args.splice(f, 2);
    return args;
  }
  return null;
}

type Tree = { [name: string]: Tree | Uint8Array };
/** The FS subtree at `path` as a YoWASP file tree (bytes are shared, not copied). */
function toTree(node: Node): Tree | Uint8Array {
  if (node.kind === "file") return node.data.subarray(0, node.size);
  const t: Tree = {};
  for (const [k, v] of node.entries) t[k] = toTree(v);
  return t;
}

/** Drop rustc's complaint that it couldn't run the linker (we link ourselves); keep warnings and real errors. */
export function withoutLinkerError(stderr: string): string {
  // Diagnostics are separated by blank lines; ANSI colors may wrap the "error" label.
  const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  return stderr
    .split(/\n(?=\S)/)
    .filter((block) => !/^error: (linking with|linker|could not exec|unable to run)|^error: aborting due to 1 previous error/.test(plain(block)))
    .join("\n");
}

export const runRust: Runner = async (code, ctx) => {
  ctx.phase("load", "Loading rustc and the standard library");
  const [rustc, sys, clang] = await ctx.timed("load", () =>
    Promise.all([
      fetchModule(engineUrl("rust", "rustc.wasm"), "rustc", ctx.progress),
      (sysroot ??= fetchBytes(engineUrl("rust", `sysroot-${TARGET}.tar`), "Rust std", ctx.progress).then((tar) => {
        const d = dir();
        mountTar(d, `lib/rustlib/${TARGET}/lib`, tar);
        return d;
      })),
      loadClang(ctx),
    ]),
  );

  const root = dir([["sysroot", sys]]);
  put(root, "/work/main.rs", code);
  put(root, "/tmp/.keep", "");

  ctx.phase("compile", "Compiling with rustc");
  let stdout = "";
  let stderr = "";
  const status = await ctx.timed("compile", () =>
    runThreaded(
      rustc,
      RUSTC_MEMORY,
      {
        args: ["rustc", "/work/main.rs", "--edition=2021", "--sysroot", "/sysroot", "--target", TARGET, "-Cpanic=abort", "-Copt-level=1", "-Ccodegen-units=1", "-Csave-temps", "--color=always", "--remap-path-prefix=/work/=", "--print", "link-args", "-o", "/work/main.wasm"],
        env: { HOME: "/work", PWD: "/work", TMPDIR: "/tmp", RUST_BACKTRACE: "0", CARGO_TERM_COLOR: "always" },
        root,
        onOutput: (fd, b) => {
          if (fd === 1) stdout += dec.decode(b, { stream: true });
          else stderr += dec.decode(b, { stream: true });
        },
      },
      () => new Worker(new URL("../wasi/thread.worker.ts", import.meta.url), { type: "module" }),
    ).catch((e: unknown) => {
      // This rustc is built with panic=abort, so after printing errors it stops by trapping (wasm `unreachable`)
      // where a native rustc would unwind and exit 1. Once diagnostics are out, that trap just means "failed".
      if (stderr.trim() && e instanceof Error && /unreachable/i.test(e.message)) return 1;
      throw e;
    }),
  );

  const link = parseLinkArgs(stdout);
  if (!link) {
    ctx.out(2, enc.encode(stderr || `rustc exited with status ${status}\n`));
    return status || 1;
  }
  const shown = withoutLinkerError(stderr).trim();
  if (shown) ctx.out(2, enc.encode(shown + "\n"));

  ctx.phase("link", "Linking with wasm-ld");
  // wasm-ld sees the same /work and /sysroot that rustc did (YoWASP mounts the tree at "/"), so rustc's absolute
  // paths to objects, rlibs, crt1 and libc resolve as they are.
  const tree: Tree = { work: toTree(lookup(root, "/work")!) as Tree, sysroot: toTree(sys) as Tree };
  let linkErr = "";
  const out = await ctx.timed("link", () => yowasp(clang, "wasm-ld", link, tree, ctx, (s) => (linkErr += s)));
  const wasm = out ? findFile(out as Tree, "work/main.wasm") : null;
  if (!wasm) {
    err(ctx, linkErr || "wasm-ld produced no program");
    return 1;
  }
  ctx.note(`linked ${(wasm.length / 1024).toFixed(0)} KB of ${TARGET}`);
  return runProgram(wasm, ctx, "main");
};

function findFile(tree: Tree, path: string): Uint8Array | null {
  let cur: Tree | Uint8Array = tree;
  for (const p of parts(path)) {
    if (cur instanceof Uint8Array) return null;
    cur = cur[p];
    if (!cur) return null;
  }
  return cur instanceof Uint8Array ? cur : null;
}
