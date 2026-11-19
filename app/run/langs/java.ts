/**
 * Java: javac (OpenJDK) and TeaVM, both compiled into one WebAssembly GC module by teavm-javac. javac turns the source
 * into class files; TeaVM compiles those, with its own implementation of the Java class library, into a WebAssembly
 * GC module, which runs here like any other program. The compiler stays loaded for the life of the worker.
 *
 * A generated launcher calls the program's main (any form Java 25 allows) so that an uncaught exception is printed by
 * Java itself, as the JVM would. WebAssembly traps (null dereference, array bounds, division by zero: TeaVM's
 * non-strict mode leaves these to the engine) bypass Java's catch blocks; they're reported as the exception the JVM
 * would have thrown.
 */
import { engineUrl, fetchBytes } from "../load";
import { err, type Ctx, type Runner } from "./ctx";
import { compileTeaVM, isJavaError, javaFrames, loadTeaVM, type JavaFrame } from "./teavm";
import { compilerJsBody, programJsBody } from "./teavm-jsbody";
import { mainMethods } from "./classfile";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Diagnostic = { type: "javac" | "teavm"; severity: "error" | "warning" | "other"; fileName: string | null; lineNumber: number; columnNumber: number; message: string };

const LAUNCHER = "__PlaygroundLauncher";

let compiler: Promise<any> | null = null;

function loadCompiler(ctx: Ctx): Promise<any> {
  compiler ??= (async () => {
    const [wasm, sdk, classlib] = await Promise.all([
      fetchBytes(engineUrl("java", "compiler.wasm"), "javac + TeaVM", ctx.progress),
      fetchBytes(engineUrl("java", "compile-classlib-teavm.bin"), "class library (javac)", ctx.progress),
      fetchBytes(engineUrl("java", "runtime-classlib-teavm.bin"), "class library (TeaVM)", ctx.progress),
    ]);
    let module: WebAssembly.Module;
    try {
      module = await compileTeaVM(wasm as BufferSource);
    } catch (e) {
      throw new Error("This browser can't run WebAssembly GC, which the Java compiler needs (Chrome 119+, Firefox 120+, Safari 18.2+)", { cause: e });
    }
    const teavm = await loadTeaVM(module, { jsBody: compilerJsBody });
    const c = teavm.exports.createCompiler();
    c.setSdk(new Int8Array(sdk.buffer, sdk.byteOffset, sdk.length));
    c.setTeaVMClasslib(new Int8Array(classlib.buffer, classlib.byteOffset, classlib.length));
    return c;
  })();
  compiler.catch(() => (compiler = null));
  return compiler;
}

/** The file javac expects: a public top-level type must live in a file named after it. */
export function javaFileName(src: string): string {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const m = /^\s*public\s+(?:(?:final|abstract|sealed|non-sealed|strictfp|static)\s+)*(?:class|interface|enum|record|@interface)\s+([\p{L}_$][\p{L}\p{N}_$]*)/mu.exec(code);
  return `${m ? m[1] : "Main"}.java`;
}

/** Java 25's launch protocol: main(String[]) over main(); an instance main runs on a new instance. */
export function launcherSource(mainClass: string, mains: { isStatic: boolean; takesArgs: boolean }[]): string | null {
  const m = mains.find((x) => x.takesArgs) ?? mains[0];
  if (!m) return null;
  const call = `${m.isStatic ? mainClass : `new ${mainClass}()`}.main(${m.takesArgs ? "args" : ""});`;
  return `public final class ${LAUNCHER} {
    public static void main(String[] args) throws Throwable {
        try {
            ${call}
        } catch (Throwable t) {
            System.out.flush();
            System.err.print("Exception in thread \\"main\\" ");
            t.printStackTrace();
            throw t;
        }
    }
}
`;
}

/**
 * A compact source file's members inside an explicit `final class Main`, with the java.base import an implicit class
 * gets. The opening line is joined to the first line of code, so line numbers don't move.
 */
export function wrapCompact(src: string): string {
  const lines = src.split("\n");
  let i = 0;
  let inComment = false;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (inComment) {
      if (l.includes("*/")) inComment = false;
      continue;
    }
    if (l === "" || l.startsWith("//") || /^import\s/.test(l)) continue;
    if (l.startsWith("/*")) {
      inComment = !l.includes("*/");
      continue;
    }
    break;
  }
  if (i === lines.length) return src;
  lines[i] = `import module java.base; final class Main { ${lines[i]}`;
  return lines.join("\n") + "\n}\n";
}

/** A diagnostic as javac prints it: `File.java:3: error: message`, the source line and a caret, then any detail. */
export function formatDiagnostic(d: Diagnostic, src: string): string {
  const [first, ...rest] = d.message.replace(/\{\{[a-z]\d+\}\}/g, "…").split("\n");
  const severity = d.severity === "other" ? "note" : d.severity;
  if (d.type === "teavm") {
    const where = d.fileName && d.lineNumber > 0 ? ` (in ${d.fileName.replace(/^org\/teavm\/classlib\//, "")}:${d.lineNumber})` : "";
    return `teavm: ${severity}: ${first}${where}\n${rest.map((l) => l + "\n").join("")}`;
  }
  let out = `${d.fileName ?? "Main.java"}${d.lineNumber > 0 ? `:${d.lineNumber}` : ""}: ${severity}: ${first}\n`;
  const line = d.lineNumber > 0 ? src.split("\n")[d.lineNumber - 1] : undefined;
  if (line !== undefined && d.columnNumber > 0) {
    out += `${line.replace(/\r$/, "")}\n${line.slice(0, d.columnNumber - 1).replace(/[^\t]/g, " ")}^\n`;
  }
  for (const l of rest) out += l + "\n";
  return out;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What the JVM would throw where the WebAssembly engine trapped instead. */
export function trapException(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : "";
  if (e instanceof RangeError || /too much recursion|call stack/i.test(msg)) return "java.lang.StackOverflowError";
  if (!(e instanceof WebAssembly.RuntimeError)) return null;
  if (/null/i.test(msg)) return "java.lang.NullPointerException";
  if (/out of bounds/i.test(msg)) return "java.lang.ArrayIndexOutOfBoundsException";
  if (/divi(de|sion) by zero/i.test(msg)) return "java.lang.ArithmeticException: / by zero";
  if (/cast/i.test(msg)) return "java.lang.ClassCastException";
  return `java.lang.InternalError: ${msg || "WebAssembly trap"}`;
}

const frameText = (f: JavaFrame) => `\tat ${f.className}.${f.method}(Unknown Source)\n`;

/**
 * An uncaught Java exception as the JVM prints it, from the JS error TeaVM made when it was created: its stack
 * runs through Throwable.fillInStackTrace and the exception's constructors, the last of which names its class.
 */
export function uncaught(e: Error): string {
  const stack = e.stack ?? "";
  let cls = "java.lang.Throwable";
  for (const m of stack.matchAll(/([\w$.]+)::<init>/g)) cls = m[1];
  const msg = e.message && e.message !== "(could not fetch message)" ? `: ${e.message}` : "";
  return `Exception in thread "main" ${cls}${msg}\n${javaFrames(stack).map(frameText).join("")}`;
}

/** UTF-16 code units from TeaVM's putchar → UTF-8 bytes, buffered and flushed on newlines. */
function utf16Writer(write: (bytes: Uint8Array) => void) {
  let buf = new Uint8Array(8192);
  let n = 0;
  let high = 0;
  const flush = () => {
    if (n) write(buf.slice(0, n)), (n = 0);
  };
  const byte = (b: number) => {
    if (n === buf.length) flush();
    buf[n++] = b;
  };
  const putchar = (unit: number) => {
    let cp = unit;
    if (unit >= 0xd800 && unit < 0xdc00) {
      if (high) putchar(0xfffd);
      high = unit;
      return;
    }
    if (unit >= 0xdc00 && unit < 0xe000) {
      if (!high) cp = 0xfffd;
      else cp = 0x10000 + ((high - 0xd800) << 10) + (unit - 0xdc00);
      high = 0;
    } else if (high) {
      high = 0;
      putchar(0xfffd);
    }
    if (cp < 0x80) byte(cp);
    else if (cp < 0x800) byte(0xc0 | (cp >> 6)), byte(0x80 | (cp & 63));
    else if (cp < 0x10000) byte(0xe0 | (cp >> 12)), byte(0x80 | ((cp >> 6) & 63)), byte(0x80 | (cp & 63));
    else byte(0xf0 | (cp >> 18)), byte(0x80 | ((cp >> 12) & 63)), byte(0x80 | ((cp >> 6) & 63)), byte(0x80 | (cp & 63));
    if (cp === 10) flush();
  };
  return { putchar, flush };
}

/** Hints for the most common walls TeaVM's class library hits. */
function hintFor(text: string): string | null {
  if (/\bScanner\b|InputStreamReader|System\.in\b/.test(text)) return "Reading stdin isn't supported in Java here: TeaVM's WebAssembly class library has no console input.";
  if (/DecimalFormat|Formatter\.formatFloat|NumberFormat/.test(text))
    return "Formatting floating-point numbers (printf's %f, %e, DecimalFormat) doesn't work in this TeaVM build; print the number directly or round it with Math.round.";
  if (/cannot find symbol/.test(text)) return "Programs compile against TeaVM's class library, which covers most of java.lang, java.util and streams but not the whole JDK.";
  return null;
}

/** Run a TeaVM program to completion: main, then every timer its green threads schedule (Thread.sleep, join, …). */
function runProgram(module: WebAssembly.Module, ctx: Ctx, launched: boolean): Promise<number> {
  return new Promise((resolve) => {
    const stdout = utf16Writer((b) => ctx.out(1, b));
    const stderr = utf16Writer((b) => ctx.out(2, b));
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let mainReturned = false;
    let finished = false;
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      for (const t of timers) clearTimeout(t);
      stdout.flush();
      stderr.flush();
      resolve(code);
    };
    const fail = (e: unknown) => {
      stdout.flush();
      const ex = trapException(e);
      if (ex) {
        const stack = e instanceof Error ? (e.stack ?? "") : "";
        const frames = javaFrames(stack, new RegExp(`^${LAUNCHER}$`));
        err(ctx, `Exception in thread "main" ${ex}\n${frames.map(frameText).join("")}`.trimEnd());
        stderr.flush();
        ctx.note("raised as a WebAssembly trap, so Java code can't catch it here");
        const hint = hintFor(frames.map((f) => `${f.className}.${f.method}`).join(" "));
        if (hint) ctx.note(hint);
      } else if (isJavaError(e)) {
        // The launcher has printed it, unless the program ran without one.
        if (!launched) err(ctx, uncaught(e as Error).trimEnd());
      } else {
        err(ctx, `java: ${e instanceof Error ? e.message : String(e)}`);
      }
      finish(1);
    };
    const settled = () => {
      if (mainReturned && timers.size === 0) finish(0);
    };

    loadTeaVM(module, {
      jsBody: programJsBody,
      hideFrames: new RegExp(`^${LAUNCHER}$`),
      installImports(imports) {
        imports.teavmConsole.putcharStdout = stdout.putchar;
        imports.teavmConsole.putcharStderr = stderr.putchar;
        imports.teavmAsync = {
          offer(fiber: unknown, resume: (fiber: unknown) => void, at: number) {
            const id = setTimeout(
              () => {
                timers.delete(id);
                if (finished) return;
                try {
                  resume(fiber);
                } catch (e) {
                  return fail(e);
                }
                settled();
              },
              Math.max(0, at - Date.now()),
            );
            timers.add(id);
            return id;
          },
          kill(id: ReturnType<typeof setTimeout>) {
            clearTimeout(id);
            timers.delete(id);
          },
        };
      },
    }).then((program) => {
      try {
        program.exports.main([]);
      } catch (e) {
        return fail(e);
      }
      mainReturned = true;
      stdout.flush();
      stderr.flush();
      settled();
    }, fail);
  });
}

export const runJava: Runner = async (code, ctx) => {
  // Java stack traces are read from JS ones (see ./teavm.ts); V8 keeps only 10 frames by default.
  (Error as { stackTraceLimit?: number }).stackTraceLimit = 100;
  ctx.phase("load", "Loading javac + TeaVM");
  const c = await ctx.timed("load", () => loadCompiler(ctx));

  const file = javaFileName(code);
  const diagnostics: Diagnostic[] = [];
  const reg = c.onDiagnostic((d: Diagnostic) =>
    diagnostics.push({ type: d.type, severity: d.severity, fileName: d.fileName, lineNumber: d.lineNumber, columnNumber: d.columnNumber, message: String(d.message) }),
  );
  const report = () => {
    const shown = diagnostics.filter((d) => d.type === "teavm" || d.fileName !== `${LAUNCHER}.java`);
    if (!shown.length) return "";
    const text = shown.map((d) => formatDiagnostic(d, code)).join("");
    const errors = shown.filter((d) => d.severity === "error").length;
    const warnings = shown.filter((d) => d.severity === "warning").length;
    const javac = shown.some((d) => d.type === "javac");
    err(ctx, text + (javac ? [errors && plural(errors, "error"), warnings && plural(warnings, "warning")].filter(Boolean).join("\n") : ""));
    diagnostics.length = 0;
    return text;
  };

  try {
    ctx.phase("compile", "Compiling with javac");
    c.clearSourceFiles();
    c.clearOutputFiles();
    c.addSourceFile(file, code);
    const ok = await ctx.timed("compile", () => c.compile());
    const text = report();
    if (!ok) {
      const hint = hintFor(text);
      if (hint) ctx.note(hint);
      return 1;
    }

    const mains: string[] = [...c.detectMainClasses()];
    const base = file.replace(/\.java$/, "");
    const mainClass = mains.find((m) => m === base || m.endsWith(`.${base}`)) ?? mains.find((m) => /(^|\.)Main$/.test(m)) ?? mains[0];
    const launcher = mainClass && launcherSource(mainClass, mainMethods(c.getOutputFile(`${mainClass.replace(/\./g, "/")}.class`)));
    if (!launcher) {
      err(ctx, `error: no main method found in ${file}\nA program needs \`public static void main(String[] args)\`, or in Java 25, just \`void main()\`.`);
      return 1;
    }
    c.addSourceFile(`${LAUNCHER}.java`, launcher);
    let entry = LAUNCHER;
    const recompile = async (src: string) => {
      diagnostics.length = 0;
      c.clearSourceFiles();
      c.clearOutputFiles();
      c.addSourceFile(file, src);
      if (src !== code || entry === LAUNCHER) c.addSourceFile(`${LAUNCHER}.java`, launcher);
      return ctx.timed("compile", () => c.compile());
    };
    if (!(await ctx.timed("compile", () => c.compile()))) {
      // A Java 25 compact source file declares its class implicitly, and such a class can't be named from other code;
      // the same members in an explicit class (with the implicit java.base import) can be. Failing that, run the
      // program directly, and report an uncaught exception from JavaScript.
      if (!(await recompile(wrapCompact(code)))) {
        entry = mainClass;
        if (!(await recompile(code))) return report(), 1;
      }
    }

    ctx.phase("link", "Compiling to WebAssembly with TeaVM");
    const ok3 = await ctx.timed("link", () => c.generateWebAssembly({ outputName: "app", mainClass: entry, obfuscated: false }));
    const teavmText = report();
    if (!ok3) {
      const hint = hintFor(teavmText + code);
      if (hint) ctx.note(hint);
      return 1;
    }
    const wasm: Int8Array = c.getWebAssemblyOutputFile("app.wasm");
    ctx.note(`generated ${(wasm.length / 1024).toFixed(0)} KB of WebAssembly GC`);
    const module = await compileTeaVM(new Uint8Array(wasm.buffer, wasm.byteOffset, wasm.length) as BufferSource);

    ctx.phase("run", "Running");
    return await ctx.timed("run", () => runProgram(module, ctx, entry === LAUNCHER));
  } finally {
    reg.destroy();
  }
};
