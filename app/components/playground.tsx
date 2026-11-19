"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Eraser, Link2, Play, RotateCcw, Square, TerminalSquare } from "lucide-react";
import { kodeMono } from "app/lib/fonts";
import { LANG_BY_ID, LANGUAGES, type LangId } from "app/lib/languages";
import { initialAnsi, parseAnsi, type AnsiState, type Segment } from "app/lib/ansi";
import { decodeShare, encodeShare } from "app/lib/share";
import { setRunning } from "app/lib/running";
import { isolated, run, stop } from "app/run/client";
import type { Phase, RunEvent } from "app/run/protocol";
import { Editor, type EditorHandle } from "./editor";
import { LangIcon, WasmIcon } from "./language-icons";

type Status =
  | { kind: "idle" }
  | { kind: "running"; label: string; progress: { label: string; loaded: number; total: number } | null }
  | { kind: "done"; code: number; timings: Partial<Record<Phase, number>> }
  | { kind: "stopped" }
  | { kind: "failed"; message: string };

const MAX_OUTPUT = 2_000_000; // characters kept in the output pane
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

const ms = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(t >= 10000 ? 0 : 1)} s` : `${Math.max(1, Math.round(t))} ms`);
const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export function Playground({ lang }: { lang: LangId }) {
  const L = LANG_BY_ID[lang];
  const editor = useRef<EditorHandle | null>(null);
  const [ready, setReady] = useState<{ code: string; shared: boolean } | null>(null);
  const code = useRef(L.examples[0].code);
  const [stdin, setStdin] = useState("");
  const [stdinOpen, setStdinOpen] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [isolatedOk, setIsolatedOk] = useState(true);
  const outRef = useRef<HTMLPreElement>(null);
  const pending = useRef<Segment[]>([]);
  const ansi = useRef<Record<1 | 2, AnsiState>>({ 1: initialAnsi(), 2: initialAnsi() });
  const decoders = useRef({ 1: new TextDecoder(), 2: new TextDecoder() });
  const size = useRef(0);
  const frame = useRef(0);

  // Load code: a share link wins, then what was last written for this language, then the first example.
  useEffect(() => {
    const shared = decodeShare(location.hash);
    if (shared) history.replaceState(null, "", location.pathname);
    const saved = store.get(`pg:code:${lang}`);
    const initial = shared?.code ?? saved ?? L.examples[0].code;
    const input = shared ? (shared.stdin ?? "") : (store.get(`pg:stdin:${lang}`) ?? L.examples.find((e) => e.code === initial)?.stdin ?? "");
    code.current = initial;
    setStdin(input);
    setStdinOpen(!!input);
    setReady({ code: initial, shared: !!shared });
    setIsolatedOk(isolated());
  }, [lang, L]);

  const append = useCallback((segs: Segment[]) => {
    pending.current.push(...segs);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const add = pending.current;
      pending.current = [];
      setSegments((prev) => {
        if (size.current >= MAX_OUTPUT) return prev;
        const next = prev.slice();
        for (const s of add) {
          size.current += s.text.length;
          const last = next[next.length - 1];
          if (last && last.cls === s.cls && last.fd === s.fd) next[next.length - 1] = { ...last, text: last.text + s.text };
          else next.push(s);
          if (size.current >= MAX_OUTPUT) {
            next.push({ text: "\n… output truncated (over 2 million characters). The program is still running; press Stop to end it.\n", cls: "ansi-2 ansi-3", fd: 2 });
            break;
          }
        }
        return next;
      });
    });
  }, []);

  // Keep the output scrolled to the bottom while it grows, unless the reader scrolled up.
  useEffect(() => {
    const el = outRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [segments]);

  const clear = () => {
    pending.current = [];
    size.current = 0;
    ansi.current = { 1: initialAnsi(), 2: initialAnsi() };
    decoders.current = { 1: new TextDecoder(), 2: new TextDecoder() };
    setSegments([]);
  };

  const onRun = useCallback(async () => {
    clear();
    setStatus({ kind: "running", label: "Starting", progress: null });
    setRunning(true);
    const onEvent = (e: RunEvent) => {
      if (e.type === "out") append(parseAnsi(decoders.current[e.fd].decode(e.data, { stream: true }), e.fd, ansi.current[e.fd]));
      else if (e.type === "note") append([{ text: `[${e.text}]\n`, cls: "ansi-2", fd: 1 }]);
      else if (e.type === "phase") setStatus({ kind: "running", label: e.label, progress: null });
      else if (e.type === "progress") setStatus((s) => (s.kind === "running" ? { ...s, progress: e } : s));
    };
    const r = await run(lang, code.current, stdin, onEvent);
    setRunning(false);
    if (r.type === "exit") setStatus({ kind: "done", code: r.code, timings: r.timings });
    else if (r.type === "fail") setStatus({ kind: "failed", message: r.message });
    else setStatus({ kind: "stopped" });
  }, [lang, stdin, append]);

  // Leaving the page (or switching language) stops a running program.
  useEffect(() => () => void (stop(lang) && setRunning(false)), [lang]);

  const onStop = () => stop(lang);
  const running = status.kind === "running";

  const onChange = useCallback(
    (c: string) => {
      code.current = c;
      store.set(`pg:code:${lang}`, c);
    },
    [lang],
  );
  const onStdin = (v: string) => {
    setStdin(v);
    store.set(`pg:stdin:${lang}`, v);
  };
  const loadExample = (i: number) => {
    const ex = L.examples[i];
    if (!ex) return;
    editor.current?.setCode(ex.code);
    onStdin(ex.stdin ?? "");
    setStdinOpen(!!ex.stdin);
    editor.current?.focus();
  };
  const share = async () => {
    const url = `${location.origin}/${lang}#${encodeShare({ code: code.current, stdin: stdin || undefined })}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      history.replaceState(null, "", url); // no clipboard access: at least put it in the address bar
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{L.name} playground</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Languages" className={`${kodeMono.className} flex flex-wrap gap-1`}>
          {LANGUAGES.map((l) => {
            const active = l.id === lang;
            return (
              <Link
                key={l.id}
                href={`/${l.id}`}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                  active ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                }`}
              >
                <LangIcon lang={l.id} size={15} />
                {l.name}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {running ? (
            <button type="button" onClick={onStop} className={`${kodeMono.className} tile flex items-center gap-2 px-4 py-2 text-sm font-semibold cursor-pointer`}>
              <Square size={14} fill="currentColor" /> Stop
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRun}
            disabled={!ready}
            className={`${kodeMono.className} btn-primary flex items-center gap-2 px-5 py-2 text-sm font-semibold cursor-pointer`}
            title="Run (⌘/Ctrl + Enter)"
          >
            <Play size={14} fill="currentColor" /> {running ? "Restart" : "Run"}
            <kbd className="hidden sm:inline text-[11px] font-normal opacity-80 ml-1">⌘↵</kbd>
          </button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:h-[calc(100svh-17rem)] lg:min-h-[34rem]">
        {/* ---------- editor ---------- */}
        <section aria-label="Code" className="flex flex-col min-h-[24rem] lg:min-h-0 border border-[var(--code-border)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-bg)] pl-3 pr-1.5 py-1.5">
            <span className="flex items-center gap-2 text-sm">
              <LangIcon lang={lang} size={14} />
              <span className="font-semibold">{L.file}</span>
              {L.experimental && <span className="text-[10px] uppercase tracking-widest border border-accent-500 text-accent-600 dark:text-accent-400 px-1.5 py-px">experimental</span>}
            </span>
            <span className="flex items-center gap-1">
              <select
                aria-label="Load an example"
                value=""
                onChange={(e) => loadExample(Number(e.target.value))}
                className="bg-transparent text-xs text-neutral-600 dark:text-neutral-400 hover:text-accent-500 px-2 py-1 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
              >
                <option value="" disabled>
                  examples…
                </option>
                {L.examples.map((ex, i) => (
                  <option key={ex.name} value={i}>
                    {ex.name}
                  </option>
                ))}
              </select>
              <IconButton label={copied ? "Link copied" : "Copy a share link"} onClick={share}>
                {copied ? <Check size={15} className="text-green-600" /> : <Link2 size={15} />}
              </IconButton>
              <IconButton label="Reset to the example" onClick={() => loadExample(0)}>
                <RotateCcw size={15} />
              </IconButton>
            </span>
          </div>
          <div className="flex-1 min-h-0 bg-[var(--code-bg)]">
            {ready ? (
              <Editor key={lang} lang={lang} initial={ready.code} onChange={onChange} onRun={onRun} handle={editor} label={`${L.name} code`} />
            ) : (
              <pre className="p-4 pl-12 text-[13.5px] leading-[1.6] text-neutral-500 overflow-hidden">{L.examples[0].code}</pre>
            )}
          </div>
        </section>

        {/* ---------- output + stdin ---------- */}
        <div className="flex flex-col gap-4 min-h-0">
          <section aria-label="Output" className="flex flex-col flex-1 min-h-[16rem] border border-[var(--code-border)]">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-bg)] pl-3 pr-1.5 py-1.5">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <TerminalSquare size={14} className="text-accent-500" /> output
              </span>
              <IconButton label="Clear output" onClick={clear}>
                <Eraser size={15} />
              </IconButton>
            </div>
            <pre
              ref={outRef}
              aria-live="polite"
              className="flex-1 min-h-0 overflow-auto bg-[var(--code-bg)] px-4 py-3 text-[13px] leading-[1.55] whitespace-pre-wrap break-words"
            >
              {segments.length === 0 && status.kind !== "running" ? (
                <Placeholder lang={lang} shared={!!ready?.shared} />
              ) : (
                segments.map((s, i) => (
                  <span key={i} className={`${s.cls}${s.fd === 2 && !s.cls ? " text-red-700 dark:text-red-300" : ""}`}>
                    {s.text}
                  </span>
                ))
              )}
            </pre>
            <StatusBar status={status} />
          </section>

          {L.noStdin ? (
            <p className="border border-[var(--code-border)] bg-[var(--code-bg)] px-3 py-1.5 text-xs text-neutral-500 shrink-0">
              <span className="font-semibold text-sm text-neutral-700 dark:text-neutral-300">stdin</span> {L.noStdin}
            </p>
          ) : (
            <section aria-label="Standard input" className="flex flex-col border border-[var(--code-border)] shrink-0">
              <button
                type="button"
                onClick={() => setStdinOpen((o) => !o)}
                aria-expanded={stdinOpen}
                className="flex items-center justify-between gap-2 bg-[var(--code-bg)] px-3 py-1.5 text-sm font-semibold cursor-pointer hover:text-accent-500 text-left"
              >
                <span>
                  stdin{" "}
                  {!stdinOpen && stdin && <span className="font-normal text-xs text-neutral-500">({stdin.split("\n").filter(Boolean).length} lines)</span>}
                </span>
                <span className="text-xs text-neutral-500">{stdinOpen ? "hide" : "show"}</span>
              </button>
              {stdinOpen && (
                <textarea
                  value={stdin}
                  onChange={(e) => onStdin(e.target.value)}
                  spellCheck={false}
                  aria-label="Standard input for the program"
                  placeholder="Text the program reads from standard input"
                  className="field border-0 border-t border-[var(--code-border)] font-mono text-[13px] min-h-24 h-28 resize-y"
                />
              )}
            </section>
          )}
        </div>
      </div>

      <p className="text-xs text-neutral-500 flex flex-wrap items-center gap-x-2 gap-y-1">
        <WasmIcon size={13} />
        <span>
          {L.how}. Runs on your device in a sandboxed worker; first run downloads {L.download}, then it&apos;s cached.{" "}
          <Link href="/about" className="underline decoration-accent-500 underline-offset-2 hover:text-accent-500">
            How it works
          </Link>
        </span>
      </p>
      {!isolatedOk && lang === "rust" && (
        <p className="text-sm text-red-700 dark:text-red-300 border border-red-500/40 px-4 py-3">
          This page isn&apos;t cross-origin isolated, so SharedArrayBuffer is unavailable and the Rust compiler (a multi-threaded WebAssembly module) can&apos;t
          start. Try reloading; some browser extensions strip the headers that enable it.
        </p>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-1.5 text-neutral-600 dark:text-neutral-400 hover:text-accent-500 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 cursor-pointer"
    >
      {children}
    </button>
  );
}

function Placeholder({ lang, shared }: { lang: LangId; shared: boolean }) {
  const L = LANG_BY_ID[lang];
  return (
    <span className="text-neutral-500">
      {shared && (
        <>
          Loaded the code from the share link.
          {"\n\n"}
        </>
      )}
      Press <span className="text-accent-600 dark:text-accent-400 font-semibold">Run</span> (⌘/Ctrl + Enter) to {L.engine === "pyodide" || L.engine === "quickjs" ? "run" : "compile and run"} this
      program.
      {"\n"}The first run downloads the {L.name} engine ({L.download}); after that it starts right away.
    </span>
  );
}

function StatusBar({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  if (status.kind === "running") {
    const p = status.progress;
    const pct = p && p.total > 0 ? Math.min(100, (p.loaded / p.total) * 100) : null;
    return (
      <div className="border-t border-[var(--code-border)] bg-[var(--code-bg)]">
        <div className="h-0.5 bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
          {pct !== null ? <div className="h-full bg-accent-500 transition-[width] duration-150" style={{ width: `${pct}%` }} /> : <div className="h-full progress-indeterminate" />}
        </div>
        <div className="flex justify-between gap-4 px-3 py-1.5 text-xs text-neutral-500">
          <span>{status.label}…</span>
          {p && <span className="tabular-nums truncate">{p.label === "std packages" ? `${p.loaded}/${p.total} packages` : `${p.label} ${mb(p.loaded)}${p.total > p.loaded ? ` / ${mb(p.total)}` : ""}`}</span>}
        </div>
      </div>
    );
  }
  const parts: React.ReactNode[] = [];
  if (status.kind === "done") {
    const ok = status.code === 0;
    parts.push(
      <span key="exit" className={`font-semibold ${ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
        exit {status.code}
      </span>,
    );
    for (const ph of ["load", "compile", "link", "run"] as const) {
      const t = status.timings[ph];
      if (t !== undefined && (ph !== "load" || t > 30)) parts.push(<span key={ph}>{`${ph} ${ms(t)}`}</span>);
    }
  } else if (status.kind === "stopped") parts.push(<span key="s" className="font-semibold text-neutral-600 dark:text-neutral-300">stopped</span>);
  else parts.push(<span key="f" className="font-semibold text-red-700 dark:text-red-400">{`error: ${status.message}`}</span>);
  return (
    <div className="border-t border-[var(--code-border)] bg-[var(--code-bg)] flex flex-wrap gap-x-3 gap-y-1 px-3 py-1.5 text-xs text-neutral-500 tabular-nums">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-3">
          {i > 0 && <span aria-hidden className="text-neutral-300 dark:text-neutral-700">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}
