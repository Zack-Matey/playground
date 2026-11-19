"use client";
/**
 * Page side of the runner: one worker per language, started on first use and kept warm, so a language's engine loads
 * once per tab. Stop terminates the worker (the only reliable way to halt a busy WebAssembly loop); the next run
 * starts a fresh one.
 */
import type { LangId } from "app/lib/languages";
import type { RunEvent, RunRequest } from "./protocol";

export type RunResult = Extract<RunEvent, { type: "exit" | "fail" }> | { type: "stopped"; id: number };

const workers = new Map<LangId, Worker>();
const active = new Map<LangId, { id: number; done: (r: RunResult) => void }>();
let seq = 0;

function worker(lang: LangId) {
  let w = workers.get(lang);
  if (!w) {
    w = new Worker(new URL("./runner.worker.ts", import.meta.url), { type: "module", name: `playground-${lang}` });
    w.onerror = (e) => {
      const a = active.get(lang);
      if (a) {
        active.delete(lang);
        a.done({ type: "fail", id: a.id, message: e.message || "The runner crashed." });
      }
      workers.get(lang)?.terminate();
      workers.delete(lang);
    };
    workers.set(lang, w);
  }
  return w;
}

export function run(lang: LangId, code: string, stdin: string, onEvent: (e: RunEvent) => void): Promise<RunResult> {
  stop(lang);
  const id = ++seq;
  const w = worker(lang);
  return new Promise<RunResult>((resolve) => {
    active.set(lang, { id, done: resolve });
    const listener = ({ data }: MessageEvent<RunEvent>) => {
      if (data.id !== id) return;
      onEvent(data);
      if (data.type === "exit" || data.type === "fail") {
        w.removeEventListener("message", listener);
        active.delete(lang);
        resolve(data);
      }
    };
    w.addEventListener("message", listener);
    w.postMessage({ type: "run", id, lang, code, stdin } satisfies RunRequest);
  });
}

/** Halt a running program (and drop its warm engine). */
export function stop(lang: LangId) {
  const a = active.get(lang);
  if (!a) return false;
  active.delete(lang);
  workers.get(lang)?.terminate();
  workers.delete(lang);
  a.done({ type: "stopped", id: a.id });
  return true;
}

export const isolated = () => typeof crossOriginIsolated === "boolean" && crossOriginIsolated;

/** For tests and the curious: window.playground.run("python", "print(1)"). Resolves to { exit, stdout, stderr }. */
if (typeof window !== "undefined")
  (window as unknown as { playground: unknown }).playground = {
    async run(lang: LangId, code: string, stdin = "") {
      const out: Record<1 | 2, string> = { 1: "", 2: "" };
      const dec = { 1: new TextDecoder(), 2: new TextDecoder() };
      const events: string[] = [];
      const r = await run(lang, code, stdin, (e) => {
        if (e.type === "out") out[e.fd] += dec[e.fd].decode(e.data, { stream: true });
        else if (e.type === "phase" || e.type === "note") events.push(e.type === "phase" ? e.label : e.text);
      });
      return { result: r, stdout: out[1], stderr: out[2], events };
    },
  };
