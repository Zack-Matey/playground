import type { LangId } from "app/lib/languages";

/** Page → runner worker. */
export type RunRequest = { type: "run"; id: number; lang: LangId; code: string; stdin: string };

export type Phase = "load" | "compile" | "link" | "run";

/** Runner worker → page. Output is raw bytes (programs may write partial UTF-8 sequences); the page decodes it. */
export type RunEvent =
  | { type: "phase"; id: number; phase: Phase; label: string }
  | { type: "progress"; id: number; label: string; loaded: number; total: number }
  | { type: "out"; id: number; fd: 1 | 2; data: Uint8Array }
  | { type: "note"; id: number; text: string }
  | { type: "exit"; id: number; code: number; timings: Partial<Record<Phase, number>> }
  | { type: "fail"; id: number; message: string };
