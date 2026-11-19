/**
 * A loader for TeaVM's WebAssembly GC modules (the teavm-javac compiler, and the programs it produces), ported from
 * TeaVM's own `*.wasm-runtime.js` (Apache-2.0, © Alexey Andreev) so that it runs under this site's Content Security
 * Policy, which forbids eval.
 *
 * TeaVM's glue builds its JavaScript-interop helpers with `new Function` (one per arity, at load time). Here they are
 * ordinary closures with rest parameters. The one thing that genuinely compiles JavaScript source is `@JSBody`: a
 * Java method whose body is a JS snippet, created at runtime through `createFunctionN`. The compiler module uses a
 * handful of these; they're shipped prebuilt (./teavm-jsbody.ts) and looked up by their exact source. Anything else
 * is refused, so a user's program can't run JavaScript at all: Java code only ever executes as WebAssembly.
 *
 * Self-contained, with no imports, so Node can load it as-is for the dev scripts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...args: any[]) => any;
type Imports = Record<string, Record<string, any>>;

/** The parts of the WebAssembly JS API that TypeScript's lib doesn't describe yet (JS string builtins, exceptions). */
type WasmExtras = {
  validate(bytes: BufferSource, options: { builtins: string[] }): boolean;
  compile(bytes: BufferSource, options: { builtins: string[] }): Promise<WebAssembly.Module>;
  Exception: new (...args: never[]) => { is(tag: unknown): boolean; getArg(tag: unknown, index: number): unknown };
};
const Wasm = WebAssembly as unknown as WasmExtras;
const BUILTINS = { builtins: ["js-string"] };

export type JsBodyResolver = (params: string[], body: string) => Fn;

export type TeaVMOptions = {
  /** Implements `@JSBody` snippets: given the parameter names and the source, return the function. */
  jsBody?: JsBodyResolver;
  /** Frames of these classes are left out of Java stack traces (e.g. a launcher wrapping main). */
  hideFrames?: RegExp;
  /** Replace or add imports before instantiation (e.g. teavmConsole). */
  installImports?: (imports: Imports) => void;
};

export type TeaVM = { exports: Record<string, any>; instance: WebAssembly.Instance; module: WebAssembly.Module };

const IDENT_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/** A global by (dotted) name: what TeaVM did with `new Function("return " + name)`. */
function getGlobal(name: string): any {
  if (!IDENT_PATH.test(name)) throw new Error(`TeaVM: not a global name: ${name}`);
  return name.split(".").reduce((o: any, p) => o[p], globalThis);
}

function setGlobal(name: string, value: unknown) {
  if (!IDENT_PATH.test(name)) throw new Error(`TeaVM: not a global name: ${name}`);
  const parts = name.split(".");
  const last = parts.pop()!;
  (parts.reduce((o: any, p) => o[p], globalThis) as any)[last] = value;
}

const JAVA_EXCEPTION = Symbol("javaException");

/** A Java exception surfacing in JavaScript. */
class JavaError extends Error {
  #ctx: Ctx;
  constructor(ctx: Ctx, javaException: unknown) {
    super();
    this.#ctx = ctx;
    (this as any)[JAVA_EXCEPTION] = javaException;
    ctx.exports["teavm.setJsException"](javaException, this);
  }
  override get message() {
    const msg = this.#ctx.exports["teavm.exceptionMessage"];
    const toJs = this.#ctx.exports["teavm.stringToJs"];
    if (typeof msg === "function" && typeof toJs === "function") {
      const m = msg((this as any)[JAVA_EXCEPTION]);
      if (m != null) return toJs(m);
    }
    return "(could not fetch message)";
  }
}

/** Whether `e` is a Java exception that reached JavaScript. */
export const isJavaError = (e: unknown) => e instanceof JavaError;

type Ctx = { exports: Record<string, any>; userExports: Record<string, any>; hideFrames?: RegExp };

let stringBuiltins: boolean | null = null;
/** Whether the engine supports the js-string builtins (otherwise they're polyfilled as imports). */
function stringBuiltinsSupported(): boolean {
  if (stringBuiltins === null) {
    const probe = new Int8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 23, 1, 14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 4, 99,
      97, 115, 116, 0, 0, 3, 1, 0, 5, 4, 1, 1, 0, 0, 10, -127, -128, -128, 0, 0,
    ]);
    // The probe is invalid exactly when builtins are supported (it imports wasm:js-string "cast" with the wrong type).
    stringBuiltins = !Wasm.validate(probe, BUILTINS);
  }
  return stringBuiltins;
}

/** A V8/SpiderMonkey/JSC frame of a TeaVM function: `at pkg.Class::method (wasm://…)` or `pkg.Class::method@wasm://…`. */
const NAMED_FRAME = /(?:at |^)([\w$.]+)::([\w$<>]+)(?: \(|@)wasm/;

export type JavaFrame = { className: string; method: string; file: string | null; line: number };

/**
 * Java stack frames from a JS stack trace through TeaVM code: the runtime's own frames are dropped, as are the
 * exception's constructors (the JVM's traces start where the exception was created).
 */
export function javaFrames(stack: string, hide?: RegExp): JavaFrame[] {
  const frames: JavaFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = NAMED_FRAME.exec(line.trim());
    if (!m) continue;
    // TeaVM suffixes overloads (`<init>_0`); Java names them all the same.
    const className = m[1];
    const method = m[2].replace(/_\d+$/, "");
    if (className.startsWith("org.teavm.") || method.includes("$caller$exported") || hide?.test(className)) continue;
    frames.push({ className, method, file: null, line: -1 });
  }
  let start = 0;
  while (start < frames.length && frames[start].className === "java.lang.Throwable" && frames[start].method !== "<init>") start++;
  while (start < frames.length && frames[start].method === "<init>" && /(Throwable|Exception|Error)$/.test(frames[start].className)) start++;
  return frames.slice(start);
}

function defaults(imports: Imports, ctx: Ctx, jsBody: JsBodyResolver) {
  if (!stringBuiltinsSupported()) {
    imports["wasm:js-string"] = {
      fromCharCode: (c: number) => String.fromCharCode(c),
      fromCharCodeArray: () => {
        throw new Error("Not supported");
      },
      intoCharCodeArray: () => {
        throw new Error("Not supported");
      },
      concat: (a: string, b: string) => a + b,
      charCodeAt: (s: string, i: number) => s.charCodeAt(i),
      length: (s: string) => s.length,
      substring: (s: string, a: number, b: number) => s.substring(a, b),
    };
  }

  const at = (t: number, f: (d: Date) => void) => {
    const d = new Date(t);
    f(d);
    return d.getTime();
  };
  imports.teavmDate = {
    currentTimeMillis: () => Date.now(),
    dateToString: (t: number) => new Date(t).toString(),
    getYear: (t: number) => new Date(t).getFullYear(),
    setYear: (t: number, v: number) => at(t, (d) => d.setFullYear(v)),
    getMonth: (t: number) => new Date(t).getMonth(),
    setMonth: (t: number, v: number) => at(t, (d) => d.setMonth(v)),
    getDate: (t: number) => new Date(t).getDate(),
    setDate: (t: number, v: number) => at(t, (d) => d.setDate(v)),
    create: (y: number, mo: number, d: number, h: number, mi: number, s: number) => new Date(y, mo, d, h, mi, s).getTime(),
    createFromUTC: (y: number, mo: number, d: number, h: number, mi: number, s: number) => Date.UTC(y, mo, d, h, mi, s),
  };

  let out = "";
  let errLine = "";
  imports.teavmConsole = {
    putcharStdout(c: number) {
      if (c === 10) (console.log(out), (out = ""));
      else out += String.fromCharCode(c);
    },
    putcharStderr(c: number) {
      if (c === 10) (console.error(errLine), (errLine = ""));
      else errLine += String.fromCharCode(c);
    },
  };

  const valueRegistry = new FinalizationRegistry((h: { queue: unknown; ref: unknown }) => {
    ctx.exports["teavm.reportGarbageCollectedValue"]?.(h.queue, h.ref);
  });
  const stringRegistry = new FinalizationRegistry((h: unknown) => {
    ctx.exports["teavm.reportGarbageCollectedString"]?.(h);
  });
  imports.teavm = {
    createWeakRef(value: object, ref: unknown, queue: unknown) {
      if (queue !== null) valueRegistry.register(value, { ref, queue });
      return new WeakRef(value);
    },
    deref: (r: WeakRef<object>) => r.deref() ?? null,
    createStringWeakRef(value: object, h: unknown) {
      stringRegistry.register(value, h);
      return new WeakRef(value);
    },
    stringDeref: (r: WeakRef<object>) => r.deref(),
    takeStackTrace() {
      // TeaVM maps code offsets to lines with debug info that teavm-javac doesn't emit; the wasm name section (modules
      // built with obfuscated: false) still names every frame.
      const stack = new Error().stack ?? "";
      return { getStack: () => javaFrames(stack, ctx.hideFrames) };
    },
    decorateException(e: unknown) {
      new JavaError(ctx, e);
    },
    linearMemory: () => ctx.exports["teavm.memory"].buffer,
    notifyHeapResized() {},
  };

  imports.teavmAsync = {
    offer: (fn: unknown, cb: Fn, at: number) => setTimeout(() => cb(fn), Math.max(0, at - Date.now())),
    kill: (id: number) => clearTimeout(id),
  };

  jso(imports, ctx, jsBody);
  imports.teavmMath = Math as any;
}

function jso(imports: Imports, ctx: Ctx, jsBody: JsBodyResolver) {
  const JAVA_OBJECT = Symbol("javaObject");
  const FUNCTIONS = Symbol("functions");
  const FUNCTION_ORIGIN = Symbol("functionOrigin");
  const WRAPPER_CALL = Symbol("wrapperCallMarker");
  const jsWrappers = new WeakMap<object, WeakRef<object>>();
  const javaWrappers = new WeakMap<object, WeakRef<object>>();
  const primitiveWrappers = new Map<unknown, WeakRef<object>>();
  const primitiveRegistry = new FinalizationRegistry((k: unknown) => primitiveWrappers.delete(k));
  const hashCodes = new WeakMap<object, number>();
  let seed = 2463534242;
  const nextHash = () => {
    let x = seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    seed = x;
    return x;
  };

  const ident = (name: string) => name.replace(/^[^A-Za-z_$]/, "_").replace(/[^\w$]/g, "_");

  /** A WebAssembly exception carrying a Java exception → the JS error for it. */
  function javaToJs(e: unknown) {
    if (e instanceof Wasm.Exception) {
      const tag = ctx.exports["teavm.javaException"];
      if (e.is(tag)) {
        const java = e.getArg(tag, 0);
        // Modules export only the helpers they use.
        const extracted = ctx.exports["teavm.js.extractException"]?.(java) ?? null;
        if (extracted !== null) return extracted;
        return ctx.exports["teavm.getJsException"]?.(java) ?? new JavaError(ctx, java);
      }
    }
    return e;
  }
  const rethrowJavaAsJs = (e: unknown): never => {
    throw javaToJs(e);
  };
  const rethrowJsAsJava = (e: any) => {
    ctx.exports["teavm.js.throwException"](e && JAVA_EXCEPTION in e ? e[JAVA_EXCEPTION] : ctx.exports["teavm.js.wrapException"](e));
  };
  const guardJs =
    (fn: Fn): Fn =>
    (...args) => {
      try {
        return fn(...args);
      } catch (e) {
        rethrowJsAsJava(e);
      }
    };

  const setProperty = (obj: any, name: string, value: unknown) => (obj === null ? setGlobal(name, value) : (obj[name] = value));

  /** A JS function calling a Java one (Java exceptions become JS errors). Arity doesn't matter to closures. */
  const exportFunction =
    (fn: Fn): Fn =>
    (...args) => {
      try {
        return fn(...args);
      } catch (e) {
        rethrowJavaAsJs(e);
      }
    };

  const named = (name: string, ctor: Fn) => {
    const f = function (this: unknown, marker: unknown, javaObject: unknown) {
      return ctor.call(this, marker, javaObject);
    };
    Object.defineProperty(f, "name", { value: name });
    return f;
  };

  const t: Record<string, any> = {
    stringBuiltinsSupported,
    isUndefined: (v: unknown) => typeof v === "undefined",
    emptyArray: () => [],
    appendToArray: (a: unknown[], v: unknown) => a.push(v),
    unwrapBoolean: (v: unknown) => (v ? 1 : 0),
    wrapBoolean: (v: unknown) => !!v,
    getProperty(obj: any, name: string) {
      try {
        return obj !== null ? obj[name] : getGlobal(name);
      } catch (e) {
        rethrowJsAsJava(e);
      }
    },
    setProperty,
    setPropertyPure: setProperty,
    global(name: string) {
      try {
        return getGlobal(name);
      } catch (e) {
        rethrowJsAsJava(e);
      }
    },
    createClass(rawName: string | null, parent: any, ctorFn: Fn | null) {
      const name = ident(rawName || "JavaObject");
      let init: (this: any, javaObject: unknown) => void;
      const cls: any = named(name, function (this: any, marker: unknown, javaObject: unknown) {
        if (marker === WRAPPER_CALL) init.call(this, javaObject);
        else if (ctorFn === null) throw new Error("This class can't be instantiated directly");
        else {
          try {
            // eslint-disable-next-line prefer-rest-params
            return ctorFn.apply(null, arguments as any);
          } catch (e) {
            rethrowJavaAsJs(e);
          }
        }
      });
      init =
        parent === null
          ? function (this: any, javaObject) {
              this[JAVA_OBJECT] = javaObject;
              this[FUNCTIONS] = null;
            }
          : function (this: any, javaObject) {
              parent.call(this, javaObject);
            };
      cls.prototype = Object.create(parent ? parent.prototype : Object.prototype);
      cls.prototype.constructor = cls;
      const wrapper: any = named(name, function (this: any, javaObject: unknown) {
        return cls.call(this, WRAPPER_CALL, javaObject);
      });
      wrapper[WRAPPER_CALL] = cls;
      wrapper.prototype = cls.prototype;
      return wrapper;
    },
    exportClass: (cls: any) => cls[WRAPPER_CALL],
    defineMethod(cls: any, name: string, fn: Fn) {
      cls.prototype[name] = function (this: unknown, ...args: unknown[]) {
        try {
          return fn(this, ...args);
        } catch (e) {
          rethrowJavaAsJs(e);
        }
      };
    },
    defineStaticMethod(cls: any, name: string, fn: Fn) {
      cls[name] = exportFunction(fn);
    },
    defineFunction: exportFunction,
    defineProperty(cls: any, name: string, get: Fn, set: Fn | null) {
      Object.defineProperty(cls.prototype, name, {
        get() {
          try {
            return get(this);
          } catch (e) {
            rethrowJavaAsJs(e);
          }
        },
        set:
          set === null
            ? undefined
            : function (this: unknown, v: unknown) {
                try {
                  set(this, v);
                } catch (e) {
                  rethrowJavaAsJs(e);
                }
              },
      });
    },
    defineStaticProperty(cls: any, name: string, get: Fn, set: Fn | null) {
      Object.defineProperty(cls, name, {
        get() {
          try {
            return get();
          } catch (e) {
            rethrowJavaAsJs(e);
          }
        },
        set:
          set === null
            ? undefined
            : (v: unknown) => {
                try {
                  set(v);
                } catch (e) {
                  rethrowJavaAsJs(e);
                }
              },
      });
    },
    javaObjectToJS(obj: object | null, cls: any) {
      if (obj === null) return null;
      const existing = jsWrappers.get(obj)?.deref();
      if (existing !== undefined) return existing;
      const w = new cls(obj);
      jsWrappers.set(obj, new WeakRef(w));
      return w;
    },
    unwrapJavaObject: (w: any) => w[JAVA_OBJECT],
    asFunction(obj: any, method: string) {
      if (obj === null || obj === undefined) return null;
      let fns = obj[FUNCTIONS];
      if (fns === null) obj[FUNCTIONS] = fns = Object.create(null);
      let f = fns[method];
      if (typeof f !== "function") {
        f = (...args: unknown[]) => obj[method](...args);
        f[FUNCTION_ORIGIN] = obj;
        fns[method] = f;
      }
      return f;
    },
    functionAsObject(fn: any, method: string) {
      if (fn === null || fn === undefined) return null;
      const origin = fn[FUNCTION_ORIGIN];
      if (origin !== undefined && origin[FUNCTIONS]?.[method] === fn) return origin;
      return {
        [method]: (...args: unknown[]) => {
          try {
            return fn(...args);
          } catch (e) {
            rethrowJavaAsJs(e);
          }
        },
      };
    },
    wrapObject(v: any) {
      if (v === null) return null;
      if (typeof v === "object" || typeof v === "function") {
        const java = v[JAVA_OBJECT];
        if (typeof java === "object") return java;
        const existing = javaWrappers.get(v)?.deref();
        if (existing !== undefined) return existing;
        const w = ctx.exports["teavm.jso.createWrapper"](v);
        javaWrappers.set(v, new WeakRef(w));
        return w;
      }
      const existing = primitiveWrappers.get(v)?.deref();
      if (existing !== undefined) return existing;
      const w = ctx.exports["teavm.jso.createWrapper"](v);
      primitiveWrappers.set(v, new WeakRef(w));
      primitiveRegistry.register(w, v);
      return w;
    },
    isPrimitive: (v: unknown, type: string) => typeof v === type || v === null,
    instanceOf: (v: unknown, cls: any) => v instanceof cls,
    instanceOfOrNull: (v: unknown, cls: any) => v === null || v instanceof cls,
    sameRef: (a: unknown, b: unknown) => a === b,
    hashCode(v: any) {
      if (typeof v === "object" || typeof v === "function" || typeof v === "symbol") {
        let h = hashCodes.get(v);
        if (typeof h !== "number") hashCodes.set(v, (h = nextHash()));
        return h;
      }
      if (typeof v === "number") return v | 0;
      if (typeof v === "bigint") return Number(BigInt.asIntN(32, v));
      if (typeof v === "boolean") return v ? 1 : 0;
      return 0;
    },
    apply(obj: any, name: string, args: unknown[]) {
      try {
        return obj === null ? getGlobal(name)(...args) : obj[name](...args);
      } catch (e) {
        rethrowJsAsJava(e);
      }
    },
    concatArray: (a: unknown[], b: unknown[]) => [...a, ...b],
    getJavaException: (e: any) => e[JAVA_EXCEPTION],
    getJSException: (e: unknown) => ctx.exports["teavm.getJsException"](e),
    jsExports: () => ctx.userExports,
  };
  for (const k of ["Byte", "Short", "Char", "Int", "Long", "Float", "Double"]) t["wrap" + k] = t["unwrap" + k] = (v: unknown) => v;

  const wrapCallFromJavaToJs = (fn: Fn) => {
    try {
      return fn();
    } catch (e) {
      rethrowJsAsJava(e);
    }
  };
  for (let n = 0; n < 32; n++) {
    // createFunctionN(p1…pN, body): an @JSBody snippet. TeaVM compiles it with `new Function`; we resolve it.
    t["createFunction" + n] = (...a: string[]) => {
      const body = a[n];
      const fn = jsBody(a.slice(0, n), body);
      return (...args: unknown[]) => fn.call(globalThis, wrapCallFromJavaToJs, ...args);
    };
    t["bindFunction" + n] = (fn: Fn, ...args: unknown[]) => fn.bind(null, ...args);
    t["callFunction" + n] = guardJs((fn: Fn, ...args: unknown[]) => fn(...args));
    t["callMethod" + n] = guardJs((obj: any, method: string, ...args: unknown[]) => (obj !== null ? obj[method](...args) : getGlobal(method)(...args)));
    t["construct" + n] = guardJs((ctor: any, ...args: unknown[]) => new ctor(...args));
    t["arrayOf" + n] = (...args: unknown[]) => args;
  }
  imports.teavmJso = t;
}

/** No @JSBody: a user's program asking for JavaScript gets a clear Java exception instead. */
export const refuseJsBody: JsBodyResolver = () => {
  throw new Error("JavaScript interop (@JSBody) isn't available: programs here run only as WebAssembly");
};

/** The JS modules a module wants as globals (TeaVM's `@JSModule` imports); the compiler and plain programs have none. */
function moduleImports(module: WebAssembly.Module): { module: string; name: string }[] {
  const s = WebAssembly.Module.customSections(module, "teavm.imports");
  if (s.length !== 1) return WebAssembly.Module.imports(module).filter((i) => i.kind === "global");
  return JSON.parse(new TextDecoder().decode(s[0]));
}

/** Compile a TeaVM module (with the JS string builtins it's built for, where the engine has them). */
export const compileTeaVM = (bytes: BufferSource) => Wasm.compile(bytes, BUILTINS);

export async function loadTeaVM(module: WebAssembly.Module, opts: TeaVMOptions = {}): Promise<TeaVM> {
  const ctx: Ctx = { exports: {}, userExports: {}, hideFrames: opts.hideFrames };
  const imports: Imports = {};
  defaults(imports, ctx, opts.jsBody ?? refuseJsBody);
  opts.installImports?.(imports);
  const missing = moduleImports(module).filter((i) => !(i.module in imports));
  if (missing.length) throw new Error(`TeaVM: JavaScript module imports aren't supported (${missing.map((i) => i.module).join(", ")})`);
  const instance = await WebAssembly.instantiate(module, imports);
  ctx.exports = instance.exports as Record<string, any>;

  const exports: Record<string, any> = ctx.userExports;
  for (const [k, v] of Object.entries(instance.exports)) {
    if (v instanceof WebAssembly.Global) Object.defineProperty(exports, k, { get: () => v.value, enumerable: true });
  }
  return { exports, instance, module };
}
