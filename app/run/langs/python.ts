/**
 * Python: Pyodide (CPython 3.14 compiled to WebAssembly), served from our own origin. Each run gets fresh globals,
 * with __name__ == "__main__". stdout/stderr are unbuffered bytes; stdin is the text from the stdin pane, so input()
 * works. Only the standard library is available (packages would come from a CDN, which the CSP blocks).
 */
import { engineUrl } from "../load";
import { enc, type Runner } from "./ctx";

type Pyodide = {
  setStdout(o: { write: (b: Uint8Array) => number }): void;
  setStderr(o: { write: (b: Uint8Array) => number }): void;
  setStdin(o: { stdin: () => string | null } | { error: true }): void;
  runPython(code: string, opts?: { globals?: unknown }): unknown;
  globals: { get(name: string): unknown };
  toPy(v: unknown): { destroy(): void };
};

let py: Promise<Pyodide> | null = null;

// Runs the user's source as __main__ and turns SystemExit and uncaught exceptions into an exit code. The traceback
// starts at the user's code (the harness frame is skipped).
const HARNESS = `
import sys, traceback
def __playground_run(src):
    g = {"__name__": "__main__", "__builtins__": __builtins__}
    try:
        exec(compile(src, "main.py", "exec"), g)
        code = 0
    except SystemExit as e:
        c = e.code
        if c is None: code = 0
        elif isinstance(c, int): code = c
        else:
            print(c, file=sys.stderr)
            code = 1
    except BaseException as e:
        traceback.print_exception(type(e), e, e.__traceback__.tb_next)
        code = 1
    sys.stdout.flush()
    sys.stderr.flush()
    return code
`;

export const runPython: Runner = async (code, ctx) => {
  ctx.phase("load", "Loading Python");
  const pyodide = await ctx.timed("load", () => {
    py ??= (async () => {
      const base = engineUrl("pyodide", "");
      // Pyodide probes for a classic worker with importScripts("data:…"), which the CSP reports as a violation. While
      // it loads, hide importScripts so it takes the module-worker path straight away (webpack needs it back after).
      const g = self as { importScripts?: unknown };
      const saved = g.importScripts;
      g.importScripts = undefined;
      let p: Pyodide;
      try {
        const { loadPyodide } = (await import(/* webpackIgnore: true */ `${base}pyodide.mjs`)) as { loadPyodide: (o: object) => Promise<Pyodide> };
        p = await loadPyodide({ indexURL: base, fullStdLib: false, checkAPIVersion: true });
      } finally {
        g.importScripts = saved;
      }
      p.runPython(HARNESS);
      return p;
    })();
    py.catch(() => (py = null));
    return py;
  });

  pyodide.setStdout({ write: (b) => (ctx.out(1, b.slice()), b.length) });
  pyodide.setStderr({ write: (b) => (ctx.out(2, b.slice()), b.length) });
  let stdin: string | null = new TextDecoder().decode(ctx.stdin);
  pyodide.setStdin({
    stdin: () => {
      const s = stdin;
      stdin = null; // the whole pane at once, then end of input
      return s;
    },
  });

  ctx.phase("run", "Running");
  return ctx.timed("run", () => {
    const run = pyodide.globals.get("__playground_run") as (src: string) => number;
    try {
      return Number(run(code));
    } catch (e) {
      ctx.out(2, enc.encode(String(e instanceof Error ? e.message : e) + "\n"));
      return 1;
    }
  });
};
