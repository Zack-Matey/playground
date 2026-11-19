/**
 * C and C++: YoWASP's Clang 22 (LLVM, clang, wasm-ld, wasi-libc and libc++ compiled to WebAssembly) compiles the
 * source to a wasm32-wasip1 program, which then runs on our WASI host. YoWASP brings its own virtual filesystem and
 * WASI runtime for the compiler; we only hand it the source and take main.wasm back.
 */
import { engineUrl, fetchBytes } from "../load";
import { runCommand } from "../wasi/wasi";
import { dir } from "../wasi/fs";
import { dec, err, type Ctx, type Runner } from "./ctx";

type Tree = { [name: string]: Tree | string | Uint8Array };
type Command = (args: string[], files: Tree, options: Record<string, unknown>) => Promise<Tree>;
type Clang = { commands: Record<"clang" | "clang++" | "wasm-ld", Command>; Exit: new () => Error & { code: number; files: Tree } };

let clang: Promise<Clang> | null = null;

/** The YoWASP bundle, loaded from our own origin (webpack must not try to bundle it). */
export function loadClang(ctx: Ctx): Promise<Clang> {
  clang ??= import(/* webpackIgnore: true */ engineUrl("clang", "bundle.js")) as Promise<Clang>;
  return clang.then(async (c) => {
    // A run with no arguments only fetches and compiles the resources, reporting progress as it goes.
    await c.commands.clang(undefined as never, {}, {
      fetchProgress: ({ totalLength, doneLength }: { totalLength: number; doneLength: number }) => ctx.progress("Clang/LLVM", doneLength, totalLength),
    });
    return c;
  });
}

/** Run a YoWASP command, streaming its output; returns the resulting file tree, or null if it failed. */
export async function yowasp(c: Clang, cmd: keyof Clang["commands"], args: string[], files: Tree, ctx: Ctx, onStderr?: (s: string) => void): Promise<Tree | null> {
  const stream = (fd: 1 | 2) => (bytes: Uint8Array | null) => {
    if (!bytes) return;
    if (fd === 2 && onStderr) onStderr(dec.decode(bytes, { stream: true }));
    else ctx.out(fd, bytes);
  };
  try {
    return await c.commands[cmd](args, files, { stdout: stream(1), stderr: stream(2), decodeASCII: false });
  } catch (e) {
    if (e instanceof c.Exit) return null;
    throw e;
  }
}

/** Run a compiled wasm32-wasip1 program on the WASI host. */
export const runProgram = async (wasm: Uint8Array, ctx: Ctx, name: string) => {
  const module = await WebAssembly.compile(wasm as BufferSource);
  ctx.phase("run", "Running");
  return ctx.timed("run", () => runTrapping(module, ctx, name));
};

/**
 * Run a program, turning a WebAssembly trap into what a native program would do: abort() and Rust panics (built
 * with panic=abort) end in `unreachable`, a stack overflow exhausts the engine's stack. Exit 134, like SIGABRT.
 */
export async function runTrapping(module: WebAssembly.Module, ctx: Ctx, name: string): Promise<number> {
  try {
    return await runCommand(module, { args: [name], env: { HOME: "/", PWD: "/" }, root: dir(), stdin: ctx.stdin, onOutput: (fd, b) => ctx.out(fd, b) });
  } catch (e) {
    const overflow = e instanceof RangeError && /call stack/i.test((e as Error).message);
    if (e instanceof WebAssembly.RuntimeError || overflow) {
      ctx.note(`program aborted: wasm trap (${overflow ? "stack overflow" : (e as Error).message})`);
      return 134;
    }
    throw e;
  }
}

const make =
  (cpp: boolean): Runner =>
  async (code, ctx) => {
    ctx.phase("load", "Loading Clang");
    const c = await ctx.timed("load", () => loadClang(ctx));
    ctx.phase("compile", cpp ? "Compiling with clang++" : "Compiling with clang");
    const src = cpp ? "main.cpp" : "main.c";
    const args = cpp
      ? ["-std=c++23", "-O2", "-fno-exceptions", "-Wall", "-fcolor-diagnostics", src, "-o", "main.wasm"]
      : ["-std=c23", "-O2", "-Wall", "-fcolor-diagnostics", src, "-o", "main.wasm", "-lm"];
    const out = await ctx.timed("compile", () => yowasp(c, cpp ? "clang++" : "clang", args, { [src]: code }, ctx));
    const wasm = out?.["main.wasm"];
    if (!(wasm instanceof Uint8Array)) {
      if (out) err(ctx, "compiler produced no program");
      return 1;
    }
    ctx.note(`compiled to ${(wasm.length / 1024).toFixed(0)} KB of wasm32-wasip1`);
    return runProgram(wasm, ctx, cpp ? "main" : "main");
  };

export const runC = make(false);
export const runCpp = make(true);
