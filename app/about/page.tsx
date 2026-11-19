import type { Metadata } from "next";
import Link from "next/link";
import { kodeMono } from "app/lib/fonts";
import { LANGUAGES, type LangId } from "app/lib/languages";
import { LangIcon, WasmIcon } from "app/components/language-icons";
import { ENGINES } from "config/engines";

export const metadata: Metadata = {
  title: "How it works",
  description: "How Playground runs Python, JavaScript, TypeScript, C, C++, Go, Rust and Java entirely in your browser with WebAssembly, and what it never sees.",
};

const H = `${kodeMono.className} text-xl font-semibold text-neutral-900 dark:text-neutral-100 mt-6`;

const PIPELINES: Record<LangId, string[]> = {
  python: ["main.py", "CPython 3.14 (Pyodide, wasm)", "output"],
  javascript: ["main.js", "QuickJS (wasm)", "output"],
  typescript: ["main.ts", "Sucrase strips types", "QuickJS (wasm)", "output"],
  c: ["main.c", "clang 22 (wasm)", "wasm-ld", "main.wasm", "WASI host"],
  cpp: ["main.cpp", "clang++ 22 + libc++ (wasm)", "wasm-ld", "main.wasm", "WASI host"],
  go: ["main.go", "go tool compile (wasm)", "go tool link (wasm)", "main.wasm", "WASI host"],
  rust: ["main.rs", "rustc 1.83 + LLVM (wasm, threaded)", "wasm-ld", "main.wasm", "WASI host"],
  java: ["Main.java", "javac 25 (wasm)", "TeaVM (wasm)", "app.wasm (WebAssembly GC)", "worker"],
};

const CREDITS = [
  { name: "Pyodide", what: "CPython compiled to WebAssembly", license: "MPL-2.0", href: "https://pyodide.org" },
  { name: "quickjs-emscripten", what: "QuickJS compiled to WebAssembly", license: "MIT", href: "https://github.com/justjake/quickjs-emscripten" },
  { name: "Sucrase", what: "TypeScript transpiler", license: "MIT", href: "https://github.com/alangpierce/sucrase" },
  { name: "YoWASP Clang", what: "LLVM, Clang, LLD, wasi-libc and libc++ compiled to WebAssembly", license: "Apache-2.0 WITH LLVM-exception", href: "https://yowasp.org" },
  { name: "Go", what: "the gc compiler, linker and standard library, built for wasip1", license: "BSD-3-Clause", href: "https://go.dev" },
  { name: "rust_wasm", what: "rustc with the LLVM backend compiled to WebAssembly, and the wasm32-wasip1 std (by oligamiq)", license: "MIT / Apache-2.0", href: "https://github.com/oligamiq/rust_wasm" },
  { name: "teavm-javac", what: "javac from OpenJDK and the TeaVM compiler, compiled together to WebAssembly GC (by Alexey Andreev)", license: "Apache-2.0; javac GPL-2.0 WITH Classpath-exception", href: "https://github.com/konsoletyper/teavm-javac" },
  { name: "TeaVM", what: "the Java class library and runtime that Java programs are compiled with", license: "Apache-2.0", href: "https://teavm.org" },
  { name: "CodeMirror", what: "the editor", license: "MIT", href: "https://codemirror.net" },
];

export default function Page() {
  return (
    <main className="max-w-3xl flex flex-col gap-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
      <h1 className={`${kodeMono.className} text-3xl font-semibold tracking-tighter text-neutral-900 dark:text-neutral-100`}>How it works</h1>
      <p>
        Playground has no servers that run code. The site is a set of static files served from Cloudflare&apos;s edge, and so are the language engines:
        real interpreters and compilers that have been compiled to <WasmIcon size={13} className="inline -mt-0.5" /> WebAssembly. When you press Run,
        your browser downloads the engine (once; it&apos;s cached after that) and runs your program on your own device.
      </p>

      <h2 className={H}>The pipeline for each language</h2>
      <div className="flex flex-col gap-2 not-prose">
        {LANGUAGES.map((l) => (
          <div key={l.id} className="card flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs">
            <Link href={`/${l.id}`} className={`${kodeMono.className} flex items-center gap-2 w-28 shrink-0 text-sm font-semibold hover:text-accent-500`}>
              <LangIcon lang={l.id} size={15} /> {l.name}
            </Link>
            {PIPELINES[l.id].map((step, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-accent-500">→</span>}
                <span className={i === 0 ? "font-semibold" : ""}>{step}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <p>
        The compiled languages produce a <code>wasm32-wasip1</code> program: a WebAssembly module that talks to the outside world through WASI (files,
        clocks, stdin and stdout). Playground implements WASI itself, over an in-memory filesystem, so the compilers can read their standard libraries
        and write their output, and the programs can read stdin and print. Nothing touches your disk.
      </p>
      <p>
        <b>Go</b> uses Go&apos;s own toolchain, not an interpreter: <code>cmd/compile</code> and <code>cmd/link</code> themselves are built for{" "}
        <code>GOOS=wasip1</code>, and only the standard-library packages your program imports (and their dependencies) are downloaded.{" "}
        <b>Rust</b> is the most ambitious: rustc is a multi-threaded WebAssembly module, so each of its threads runs in its own worker sharing one
        memory. rustc can&apos;t start a linker in a browser, so Playground asks it for the exact link command and runs it with wasm-ld from the Clang
        engine.{" "}
        <b>Java</b> is two compilers in one WebAssembly module: javac turns your source into class files, then TeaVM compiles those, with its own
        implementation of the Java class library, into a WebAssembly GC program (objects live on the browser&apos;s garbage-collected heap).
      </p>

      <h2 className={H}>The sandbox</h2>
      <p>
        Every program runs in a Web Worker, inside a WebAssembly engine, never on the page itself. JavaScript too: it runs in QuickJS, a separate
        JavaScript engine compiled to wasm, so your code can&apos;t touch the page, your cookies or the network. The site&apos;s Content Security Policy
        only allows connections to this site, as a second wall. Stop terminates the worker, which ends even an infinite loop.
      </p>
      <p>
        The site is cross-origin isolated (the <code>Cross-Origin-Opener-Policy</code> and <code>Cross-Origin-Embedder-Policy</code> headers), which is
        what lets the Rust compiler share memory between its threads.
      </p>

      <h2 className={H}>Privacy</h2>
      <p>
        No accounts, no ads, no cookies. Your code and stdin are kept in this browser&apos;s local storage so they&apos;re there next time, and never sent
        anywhere. A share link puts the code in the URL&apos;s fragment (after the #), which browsers don&apos;t send to servers: the snippet exists only in the
        link. Engine downloads appear in Cloudflare&apos;s request logs like any other file.
      </p>

      <h2 className={H}>Limits</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>One file per program. Python and Go have their standard libraries; Rust has std but no crates; C and C++ have libc and libc++; Java has TeaVM&apos;s class library.</li>
        <li>Nothing can use the network or spawn processes (WASI preview 1 has neither). Threads work in Go (goroutines) and Java (green threads on one core) but not in C, C++ or Rust programs.</li>
        <li>C++ is compiled with <code>-fno-exceptions</code>: the WASI build of libc++ has no exception support.</li>
        <li>TypeScript types are stripped, not checked.</li>
        <li>
          Java is experimental. Programs compile against TeaVM&apos;s class library, which covers most of <code>java.lang</code>, <code>java.util</code>{" "}
          and streams but not the whole JDK: there&apos;s no <code>Scanner</code> or stdin, no <code>System.exit</code>, and floating-point formatting (
          <code>%f</code>, <code>DecimalFormat</code>) doesn&apos;t work. Null dereferences, array bounds and division by zero end the program (they
          can&apos;t be caught), and stack traces have no line numbers. It needs a browser with WebAssembly GC.
        </li>
        <li>
          Rust is experimental: the compiler is rustc 1.83 (edition 2021), it needs a browser with SharedArrayBuffer, and it uses up to a gigabyte of
          memory while compiling.
        </li>
        <li>Input is read from the stdin box before the program starts; there&apos;s no interactive terminal.</li>
      </ul>

      <h2 className={H}>Engines and credits</h2>
      <ul className="flex flex-col gap-1.5">
        {CREDITS.map((c) => (
          <li key={c.name}>
            <a href={c.href} className="font-semibold underline decoration-accent-500 underline-offset-2 hover:text-accent-500">
              {c.name}
            </a>
            : {c.what} <span className="text-neutral-500">({c.license})</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500">
        Versions: {Object.values(ENGINES)
          .map((e) => e.label)
          .join(" · ")}
        .
      </p>
      <p>
        Part of{" "}
        <a href="https://zackmatey.com" className="underline decoration-accent-500 underline-offset-2 hover:text-accent-500">
          zackmatey.com
        </a>
        .
      </p>
    </main>
  );
}
