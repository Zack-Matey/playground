import type { Progress } from "../load";
import type { Phase } from "../protocol";

/** What a language runner gets from the runner worker. */
export type Ctx = {
  phase(p: Phase, label: string): void;
  progress: Progress;
  out(fd: 1 | 2, data: Uint8Array): void;
  /** A line of status in the output (dimmed), e.g. "linked 1.2 MB". */
  note(text: string): void;
  stdin: Uint8Array;
  /** Time a phase; the total shows under the output. */
  timed<T>(phase: Phase, fn: () => Promise<T> | T): Promise<T>;
};

export type Runner = (code: string, ctx: Ctx) => Promise<number>;

export const enc = new TextEncoder();
export const dec = new TextDecoder();
export const err = (ctx: Ctx, text: string) => ctx.out(2, enc.encode(text.endsWith("\n") ? text : text + "\n"));
