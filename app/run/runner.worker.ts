/// <reference lib="webworker" />
/**
 * The runner: one module Web Worker per language, kept alive between runs so engines load once. All user code runs
 * here (or in nested thread workers), inside WebAssembly, never on the page. Stopping a run terminates the worker.
 */
import type { Phase, RunEvent, RunRequest } from "./protocol";
import type { Ctx, Runner } from "./langs/ctx";
import type { LangId } from "app/lib/languages";

const RUNNERS: Record<LangId, () => Promise<Runner>> = {
  python: () => import("./langs/python").then((m) => m.runPython),
  javascript: () => import("./langs/js").then((m) => m.runJs),
  typescript: () => import("./langs/js").then((m) => m.runTs),
  c: () => import("./langs/clang").then((m) => m.runC),
  cpp: () => import("./langs/clang").then((m) => m.runCpp),
  go: () => import("./langs/go").then((m) => m.runGo),
  rust: () => import("./langs/rust").then((m) => m.runRust),
  java: () => import("./langs/java").then((m) => m.runJava),
};

/** A one-line description of anything thrown (some engines throw errors with an empty message, or non-Errors). */
function describe(e: unknown): string {
  if (e instanceof Error) {
    const cause = e.cause !== undefined ? ` (${describe(e.cause)})` : "";
    return (e.message ? (e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message) : e.name || "Unknown error") + cause;
  }
  if (typeof e === "object" && e) return JSON.stringify(e).slice(0, 500);
  return String(e);
}

const post = (e: RunEvent, transfer: Transferable[] = []) => postMessage(e, transfer);

onmessage = async ({ data }: MessageEvent<RunRequest>) => {
  if (data.type !== "run") return;
  const { id } = data;
  const timings: Partial<Record<Phase, number>> = {};

  // Output is batched: a program printing in a tight loop would otherwise flood the page with messages.
  let pending: { fd: 1 | 2; chunks: Uint8Array[]; size: number } | null = null;
  let last = 0;
  const flush = () => {
    if (!pending) return;
    const buf = new Uint8Array(pending.size);
    let o = 0;
    for (const c of pending.chunks) buf.set(c, o), (o += c.length);
    post({ type: "out", id, fd: pending.fd, data: buf }, [buf.buffer]);
    pending = null;
    last = performance.now();
  };
  let lastProgress = 0;

  const ctx: Ctx = {
    phase: (phase, label) => (flush(), post({ type: "phase", id, phase, label })),
    progress: (label, loaded, total) => {
      const t = performance.now();
      if (t - lastProgress < 50 && loaded < total) return;
      lastProgress = t;
      post({ type: "progress", id, label, loaded, total });
    },
    out: (fd, bytes) => {
      if (pending && pending.fd !== fd) flush();
      pending ??= { fd, chunks: [], size: 0 };
      pending.chunks.push(bytes.slice());
      pending.size += bytes.length;
      if (pending.size > 64 * 1024 || performance.now() - last > 16) flush();
    },
    note: (text) => (flush(), post({ type: "note", id, text })),
    stdin: new TextEncoder().encode(data.stdin),
    timed: async (phase, fn) => {
      const t = performance.now();
      try {
        return await fn();
      } finally {
        timings[phase] = (timings[phase] ?? 0) + performance.now() - t;
      }
    },
  };

  try {
    const run = await RUNNERS[data.lang]();
    const code = await run(data.code, ctx);
    flush();
    post({ type: "exit", id, code, timings });
  } catch (e) {
    flush();
    console.error(e);
    post({ type: "fail", id, message: describe(e) });
  }
};
