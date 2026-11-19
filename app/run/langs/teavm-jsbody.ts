/**
 * The @JSBody snippets inside the teavm-javac compiler module (public/engines/java-*), as real functions so nothing
 * is compiled from source at runtime (see ./teavm.ts). Keyed by "param,param|body", exactly as the module passes
 * them. Found with `strings compiler.wasm` and confirmed by scripts/dev/teavm-probe.mjs, which fails loudly on any
 * snippet missing here; re-check both when the engine version changes.
 */
import type { JsBodyResolver } from "./teavm";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Body = (wrapCallFromJavaToJs: unknown, ...args: any[]) => unknown;

/** The compiler's own snippets. */
const COMPILER: Record<string, Body> = {
  "|return Object.create(null);": () => Object.create(null),
  "array|return array;": (_, array) => array,
  "__this__|return __this__;": (_, self) => self,
  "number|return number;": (_, n) => n,
  "str|return str;": (_, s) => s,
  "size|return new Array(size);": (_, size) => new Array(size),
};

/**
 * Snippets in TeaVM's runtime class library, which compiled programs carry. Only these: a program's own @JSBody
 * methods are refused, so user code can't run JavaScript.
 */
const PROGRAM: Record<string, Body> = {
  "str|return str;": (_, s) => s,
};

const resolver =
  (table: Record<string, Body>, what: string): JsBodyResolver =>
  (params, body) => {
    const fn = table[`${params.join(",")}|${body}`];
    if (!fn) throw new Error(`${what}: JavaScript interop (@JSBody) isn't available here; programs run only as WebAssembly. (${params.join(", ")}) ${JSON.stringify(body)}`);
    return fn;
  };

export const compilerJsBody = resolver(COMPILER, "Java compiler");
export const programJsBody = resolver(PROGRAM, "Java");
