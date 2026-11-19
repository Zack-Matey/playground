/**
 * Host side of wasm32-wasip1-threads (used by rustc, which always runs the compiler on a spawned thread).
 *
 * The host is the runner worker. It owns the Wasi state (filesystem, fds) and never runs guest code itself, so it is
 * always free to answer. Every guest thread, including the main one, runs in its own nested Worker that shares one
 * WebAssembly.Memory. A thread makes a syscall by writing the call into its control block (a small
 * SharedArrayBuffer), posting a message, and blocking with Atomics.wait. The host performs the call directly against
 * the shared memory, writes the result and wakes it. `thread-spawn` is answered the same way: the host starts the new
 * Worker (a blocked thread couldn't), and the new thread enters `wasi_thread_start`.
 *
 * Needs cross-origin isolation (SharedArrayBuffer), which the site's COOP/COEP headers provide.
 */
import { Exit, Wasi, type WasiOptions } from "./wasi";

export const CTRL_BYTES = 16 + 16 * 8; // i32[4] {flag, fn, argc, result} + i64[16] args
export const SPAWN = -1;

export type ThreadInit = { module: WebAssembly.Module; memory: WebAssembly.Memory; ctrl: SharedArrayBuffer; tid: number; startArg: number; names: string[] };
export type ThreadMsg = { t: "call" } | { t: "done" } | { t: "exit" } | { t: "error"; message: string };

export function runThreaded(
  module: WebAssembly.Module,
  memory: { initial: number; maximum: number },
  opts: WasiOptions,
  newWorker: () => Worker,
): Promise<number> {
  const mem = new WebAssembly.Memory({ ...memory, shared: true });
  const wasi = new Wasi(opts);
  wasi.memory = mem;
  const fns = wasi.fns as unknown as Record<string, (...a: bigint[]) => number>;
  const names = WebAssembly.Module.imports(module)
    .filter((i) => i.module === "wasi_snapshot_preview1")
    .map((i) => i.name);
  const workers: Worker[] = [];
  let nextTid = 1;

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      for (const w of workers) w.terminate();
      fn();
    };

    const spawn = (tid: number, startArg: number) => {
      const ctrl = new SharedArrayBuffer(CTRL_BYTES);
      const i32 = new Int32Array(ctrl, 0, 4);
      const args = new BigInt64Array(ctrl, 16, 16);
      const w = newWorker();
      workers.push(w);
      w.onerror = (e) => finish(() => reject(new Error(e.message || "thread worker failed to start")));
      w.onmessage = ({ data }: MessageEvent<ThreadMsg>) => {
        if (data.t === "done") return finish(() => resolve(0));
        if (data.t === "error") return finish(() => reject(new Error(data.message)));
        if (data.t !== "call") return;
        const fn = i32[1];
        const a = Array.from(args.subarray(0, i32[2]));
        let result: number;
        if (fn === SPAWN) {
          const id = nextTid++;
          spawn(id, Number(a[0]));
          result = id;
        } else {
          const name = names[fn];
          if (name === "proc_exit") return finish(() => resolve(Number(BigInt.asUintN(32, a[0]))));
          const impl = fns[name];
          try {
            result = impl ? impl(...a) : 52; // ENOSYS
          } catch (e) {
            if (e instanceof Exit) return finish(() => resolve(e.code));
            return finish(() => reject(e));
          }
        }
        i32[3] = result;
        Atomics.store(i32, 0, 1);
        Atomics.notify(i32, 0);
      };
      w.postMessage({ module, memory: mem, ctrl, tid, startArg, names } satisfies ThreadInit);
    };

    spawn(0, 0);
  });
}
