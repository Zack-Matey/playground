/// <reference lib="webworker" />
/**
 * One guest thread of a wasm32-wasip1-threads module (see ./threads.ts). Every WASI call is forwarded to the host
 * worker and this thread blocks until it answers. Thread 0 runs `_start`; the rest enter `wasi_thread_start`.
 */
import { SPAWN, type ThreadInit, type ThreadMsg } from "./threads";

const post = (m: ThreadMsg) => postMessage(m);

onmessage = async ({ data }: MessageEvent<ThreadInit>) => {
  const { module, memory, ctrl, tid, startArg, names } = data;
  const i32 = new Int32Array(ctrl, 0, 4);
  const args = new BigInt64Array(ctrl, 16, 16);
  const call = (fn: number, a: (number | bigint)[]) => {
    for (let i = 0; i < a.length; i++) args[i] = BigInt(a[i]);
    i32[1] = fn;
    i32[2] = a.length;
    Atomics.store(i32, 0, 0);
    post({ t: "call" });
    Atomics.wait(i32, 0, 0);
    return i32[3];
  };
  const wasi: Record<string, (...a: (number | bigint)[]) => number> = {};
  names.forEach((n, i) => (wasi[n] = (...a) => call(i, a)));
  try {
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi,
      wasi: { "thread-spawn": (arg: number) => call(SPAWN, [arg]) },
      env: { memory },
    });
    if (tid === 0) {
      (instance.exports._start as () => void)();
      post({ t: "done" });
    } else {
      (instance.exports.wasi_thread_start as (tid: number, arg: number) => void)(tid, startArg);
      post({ t: "exit" });
    }
  } catch (e) {
    post({ t: "error", message: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e) });
  }
};
