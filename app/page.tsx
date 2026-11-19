import Link from "next/link";
import { Cpu, Gauge, Lock, Share2 } from "lucide-react";
import { SiCloudflare } from "react-icons/si";
import { kodeMono } from "app/lib/fonts";
import { LANGUAGES } from "app/lib/languages";
import { LangIcon, WasmIcon } from "app/components/language-icons";

const POINTS = [
  { icon: <WasmIcon size={18} />, title: "Real toolchains in WebAssembly", text: "CPython, Clang, Go's gc compiler, rustc and javac, compiled to wasm. Not a server pretending to be your browser." },
  { icon: <Lock size={18} className="text-accent-500" />, title: "Sandboxed on your device", text: "Programs run in a Web Worker inside a wasm sandbox, with no network access. Your code never leaves the browser." },
  { icon: <SiCloudflare size={18} className="text-[#F38020]" />, title: "Static, at the edge", text: "The site and the engines are files served from Cloudflare's edge. There is no server that runs code." },
  { icon: <Gauge size={18} className="text-accent-500" />, title: "Fast after the first run", text: "Engines download once and are cached. The next run of a language starts instantly." },
  { icon: <Share2 size={18} className="text-accent-500" />, title: "Shareable", text: "A share link carries the code in its #fragment, which browsers never send to a server." },
  { icon: <Cpu size={18} className="text-accent-500" />, title: "stdin, exit codes, timings", text: "Feed input, see colored compiler diagnostics, and how long each phase took." },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-14">
      <section className="flex flex-col gap-5 max-w-3xl">
        <h1 className={`${kodeMono.className} text-4xl sm:text-5xl font-semibold tracking-tighter leading-[1.05]`}>
          Run code in your browser<span className="text-accent-500">.</span>
        </h1>
        <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-400 leading-relaxed">
          Python, JavaScript, TypeScript, C, C++, Go, Rust and Java. Every interpreter and compiler runs as{" "}
          <span className="text-[#654FF0] dark:text-[#8f7ff5] font-semibold">WebAssembly</span> on your own device, sandboxed in a worker. Nothing you write is
          uploaded. No sign-up, no ads.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/python" className={`${kodeMono.className} btn-primary px-5 py-2.5 font-semibold`}>
            start with Python
          </Link>
          <Link href="/about" className={`${kodeMono.className} tile px-5 py-2.5 font-semibold`}>
            how it works
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-neutral-500 mb-3">Languages</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {LANGUAGES.map((l) => (
            <Link key={l.id} href={`/${l.id}`} className="group card flex flex-col gap-2 p-4 hover:border-accent-500 transition-colors">
              <span className={`${kodeMono.className} flex items-center gap-2.5 text-lg font-semibold group-hover:text-accent-500 transition-colors`}>
                <LangIcon lang={l.id} size={22} />
                {l.name}
                {l.experimental && <span className="ml-auto text-[10px] font-normal uppercase tracking-widest text-accent-600 dark:text-accent-400">experimental</span>}
              </span>
              <span className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">{l.how}.</span>
              <span className="text-[11px] text-neutral-500 mt-auto">first run {l.download}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
        {POINTS.map((p) => (
          <div key={p.title} className="flex gap-3">
            <span className="mt-0.5">{p.icon}</span>
            <span className="flex flex-col gap-1">
              <span className={`${kodeMono.className} font-semibold`}>{p.title}</span>
              <span className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">{p.text}</span>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
