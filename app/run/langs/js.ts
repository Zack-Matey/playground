/**
 * JavaScript and TypeScript: QuickJS compiled to WebAssembly (quickjs-emscripten). The code runs as an ES module
 * (top-level await works) in a fresh runtime per run, with no access to the page, the network or the host's globals.
 * TypeScript is transpiled first with Sucrase (types are stripped, not checked).
 *
 * The event loop lives here: after the module evaluates, we drain promise jobs, then sleep until the next timer and
 * fire it, until nothing is left.
 */
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSWASMModule } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import { transform } from "sucrase";
import { PRELUDE } from "./prelude";
import { enc, err, type Ctx, type Runner } from "./ctx";

// The variant module (its JS glue) loads once; each run gets a brand-new QuickJS wasm instance (see run()).
let warmed: Promise<QuickJSWASMModule> | null = null;
const sleeper = typeof SharedArrayBuffer === "function" ? new Int32Array(new SharedArrayBuffer(4)) : null;
const sleep = (ms: number) => {
  if (ms <= 0) return;
  if (sleeper) Atomics.wait(sleeper, 0, 0, ms);
  else for (const end = performance.now() + ms; performance.now() < end; );
};

function stdinLines(bytes: Uint8Array) {
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return () => lines.shift();
}

async function run(source: string, filename: string, ctx: Ctx): Promise<number> {
  ctx.phase("load", "Loading QuickJS");
  // A fresh wasm instance per run: runs can't see each other's globals, and an uncaught error can leave objects that
  // make freeing a runtime abort. The old instance is simply dropped for the garbage collector. The .wasm itself is in
  // the HTTP cache after the first run, so this costs a few milliseconds.
  const mod = await ctx.timed("load", async () => {
    if (!warmed) {
      warmed = newQuickJSWASMModuleFromVariant(variant);
      return warmed;
    }
    return newQuickJSWASMModuleFromVariant(variant);
  });
  ctx.phase("run", "Running");
  return ctx.timed("run", () => {
    const rt = mod.newRuntime();
    rt.setMemoryLimit(1024 * 1024 * 1024);
    // No setMaxStackSize: a limit larger than the wasm stack makes QuickJS report an overflow on the first statement.
    const vm = rt.newContext();
    let code = 0;
    const readline = stdinLines(ctx.stdin);
    try {
      const host = vm.newObject();
      const fn = (name: string, f: (...a: QuickJSHandle[]) => QuickJSHandle | void) => {
        const h = vm.newFunction(name, f);
        vm.setProp(host, name, h);
        h.dispose();
      };
      fn("write", (fd, s) => ctx.out(vm.getNumber(fd) === 2 ? 2 : 1, enc.encode(vm.getString(s))));
      fn("now", () => vm.newNumber(performance.now()));
      fn("readline", () => {
        const l = readline();
        return l === undefined ? vm.null : vm.newString(l);
      });
      vm.setProp(vm.global, "__host", host);
      host.dispose();
      const pre = vm.evalCode(PRELUDE, "prelude.js");
      if (pre.error) throw new Error(`prelude failed: ${JSON.stringify(vm.dump(pre.error))}`);
      pre.value.dispose();

      const result = vm.evalCode(source, filename, { type: "module" });
      if (result.error) {
        report(vm, result.error, ctx);
        result.error.dispose();
        return 1;
      }
      const promise = result.value;
      const loop = vm.getProp(vm.global, "__loop");
      const call = (name: string) => {
        const f = vm.getProp(loop, name);
        const r = vm.callFunction(f, loop);
        f.dispose();
        return r;
      };
      const drain = () => {
        const jobs = rt.executePendingJobs();
        if (jobs.error) {
          report(vm, jobs.error, ctx);
          jobs.error.dispose();
          code = 1;
        }
      };
      for (;;) {
        drain();
        const state = vm.getPromiseState(promise);
        if (state.type === "rejected") {
          report(vm, state.error, ctx);
          state.error.dispose();
          code = 1;
          break;
        }
        const next = call("next");
        if (next.error) throw new Error(`event loop failed: ${JSON.stringify(vm.dump(next.error))}`);
        const ms = vm.getNumber(next.value);
        next.value.dispose();
        if (ms < 0) break;
        sleep(ms);
        const fired = call("fire");
        if (fired.error) {
          // An uncaught exception in a timer callback ends the program, as in Node.
          report(vm, fired.error, ctx);
          fired.error.dispose();
          code = 1;
          break;
        }
        fired.value.dispose();
      }
      loop.dispose();
      promise.dispose();
    } catch (e) {
      // A host-side failure: report it; the instance is discarded either way.
      err(ctx, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
      code = 1;
    }
    return code;
  });
}

function report(vm: QuickJSContext, error: QuickJSHandle, ctx: Ctx) {
  const e = vm.dump(error) as { name?: string; message?: string; stack?: string } | string;
  if (typeof e === "object" && e && e.message !== undefined) {
    const stack = (e.stack ?? "").replace(/\n$/, "");
    err(ctx, `Uncaught ${e.name ?? "Error"}: ${e.message}${stack ? "\n" + stack : ""}`);
  } else err(ctx, `Uncaught ${typeof e === "string" ? e : JSON.stringify(e)}`);
}

export const runJs: Runner = (code, ctx) => run(code, "main.js", ctx);

export const runTs: Runner = async (code, ctx) => {
  let js: string;
  try {
    ctx.phase("compile", "Transpiling with Sucrase");
    js = await ctx.timed("compile", () => transform(code, { transforms: ["typescript"], disableESTransforms: true, filePath: "main.ts" }).code);
  } catch (e) {
    err(ctx, `main.ts: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  return run(js, "main.ts", ctx);
};
