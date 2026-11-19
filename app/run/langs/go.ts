/**
 * Go: the real gc toolchain. cmd/compile and cmd/link are built for GOOS=wasip1 (scripts/fetch-engines.mjs) and run
 * on our WASI host, against the standard library compiled for wasip1. The program is linked as a wasip1 executable
 * and run on the same host. Only the std packages a program actually needs (its imports and their dependencies) are
 * downloaded, each one cached after first use.
 */
import { ENGINES } from "config/engines";
import { engineUrl, fetchBytes, fetchJson, fetchModule } from "../load";
import { dir, put, read } from "../wasi/fs";
import { runCommand } from "../wasi/wasi";
import { err, type Runner } from "./ctx";
import { runTrapping } from "./clang";

type Std = { go: string; packages: Record<string, string[]> };
let std: Promise<Std> | null = null;

/** The import paths of a Go source file (comments and strings elsewhere ignored). */
export function goImports(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out = new Set<string>();
  const spec = /(?:^|\s)(?:[\p{L}_][\p{L}\p{N}_]*\s+|\.\s+|_\s+)?"([^"]+)"/u;
  for (const m of code.matchAll(/\bimport\s*\(([^)]*)\)/g))
    for (const line of m[1].split(/[\n;]/)) {
      const s = spec.exec(line);
      if (s) out.add(s[1]);
    }
  for (const m of code.matchAll(/\bimport\s+(?:[\p{L}_][\p{L}\p{N}_]*\s+|\.\s+|_\s+)?"([^"]+)"/gu)) out.add(m[1]);
  return [...out];
}

/** Every package `roots` depend on, dependencies first. */
export function closure(pkgs: Record<string, string[]>, roots: string[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (p: string) => {
    if (seen.has(p) || !(p in pkgs)) return;
    seen.add(p);
    for (const d of pkgs[p] ?? []) visit(d);
    order.push(p);
  };
  roots.forEach(visit);
  return order;
}

export const runGo: Runner = async (code, ctx) => {
  ctx.phase("load", "Loading the Go toolchain");
  const [s, compile, link] = await ctx.timed("load", () =>
    Promise.all([
      (std ??= fetchJson<Std>(engineUrl("go", "std.json"))),
      fetchModule(engineUrl("go", "compile.wasm"), "go compiler", ctx.progress),
      fetchModule(engineUrl("go", "link.wasm"), "go linker", ctx.progress),
    ]),
  );

  const imports = goImports(code);
  // "unsafe" is built into the compiler: it has no archive and needs no importcfg entry.
  const missing = imports.filter((p) => p !== "unsafe" && !(p in s.packages));
  if (missing.length) {
    err(ctx, `Only the standard library is available here (no module downloads). Not found: ${missing.map((m) => `"${m}"`).join(", ")}`);
    return 1;
  }
  const needed = closure(s.packages, ["runtime", ...imports]);
  const root = dir();
  ctx.phase("load", `Loading ${needed.length} standard library packages`);
  let done = 0;
  await ctx.timed("load", () =>
    Promise.all(
      needed.map(async (p) => {
        put(root, `/go/pkg/${p}.a`, await fetchBytes(engineUrl("go", `pkg/${p}.a`), p));
        ctx.progress("std packages", ++done, needed.length);
      }),
    ),
  );
  const cfg = (pkgs: string[]) => pkgs.map((p) => `packagefile ${p}=/go/pkg/${p}.a`).join("\n") + "\n";
  put(root, "/work/main.go", code);
  put(root, "/work/importcfg", cfg(imports.filter((p) => p in s.packages)));
  put(root, "/work/importcfg.link", cfg(needed));

  const env = { GOOS: "wasip1", GOARCH: "wasm", HOME: "/work", PWD: "/work", GOROOT: "/go", TMPDIR: "/tmp" };
  put(root, "/tmp/.keep", "");
  // The compiler and linker print diagnostics on stdout; show them as errors. Failures exit 1, as `go run` does.
  const tool = async (module: WebAssembly.Module, args: string[]) =>
    ((await runCommand(module, { args, env, root, onOutput: (_fd, b) => ctx.out(2, b) })) === 0 ? 0 : 1);

  ctx.phase("compile", `Compiling with ${ENGINES.go.version}`);
  const lang = /^go(\d+\.\d+)/.exec(s.go)?.[1];
  const c = await ctx.timed("compile", () =>
    tool(compile, ["compile", "-o", "/work/main.a", "-p", "main", "-complete", "-pack", "-c=1", "-trimpath=/work", ...(lang ? [`-lang=go${lang}`] : []), "-importcfg", "/work/importcfg", "main.go"]),
  );
  if (c !== 0) return c;

  ctx.phase("link", "Linking");
  const l = await ctx.timed("link", () => tool(link, ["link", "-o", "/work/main.wasm", "-importcfg", "/work/importcfg.link", "-buildmode=exe", "-s", "-w", "/work/main.a"]));
  if (l !== 0) return l;
  const wasm = read(root, "/work/main.wasm")!;
  ctx.note(`linked ${(wasm.length / 1048576).toFixed(1)} MB of wasip1/wasm`);

  const program = await WebAssembly.compile(wasm as BufferSource);
  ctx.phase("run", "Running");
  return ctx.timed("run", () => runTrapping(program, ctx, "main"));
};
