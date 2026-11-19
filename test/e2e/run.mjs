// Run real programs in every language in headless Chrome, against a running site, and check the results.
//   node test/e2e/run.mjs [base=http://localhost:3000] [lang,…]
// Uses the page's window.playground.run (the same runner workers the UI uses), then drives the UI itself once
// (click Run, read the output pane). Also fails on CSP violations, uncaught errors and missing cross-origin isolation.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const only = process.argv[3]?.split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------- browser ----------
const profile = mkdtempSync(path.join(tmpdir(), "pg-e2e-"));
const port = 9400 + Math.floor(Math.random() * 50);
const chrome = spawn(
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1400,1000", "--no-first-run", "about:blank"],
  { stdio: "ignore" },
);
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((r, j) => (ws.addEventListener("open", r, { once: true }), ws.addEventListener("error", j, { once: true })));
    }
  } catch {
    ws = undefined;
  }
  if (!ws) await sleep(200);
}
let n = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id));
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails.text);
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon|Failed to load resource/i.test(m.params.entry.text)) errors.push(m.params.entry.text.slice(0, 300));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
});
const send = (method, params = {}, ms = 300000) =>
  new Promise((res, rej) => {
    const i = ++n;
    const timer = setTimeout(() => (pending.delete(i), rej(new Error(`${method} timed out`))), ms);
    pending.set(i, (m) => (clearTimeout(timer), m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expr, ms) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, ms);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const goto = async (url) => {
  await send("Page.navigate", { url });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (await evaluate("document.readyState === 'complete' && !!window.playground").catch(() => false)) return;
  }
  throw new Error(`${url} did not load`);
};
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

// ---------- programs ----------
const CASES = {
  python: [
    { code: "import sys\nprint('hi', sum(range(10)))\nname = input()\nprint('name=' + name)\nsys.exit(3)", stdin: "ada\n", out: "hi 45\nname=ada\n", exit: 3 },
    { code: "1/0", exit: 1, err: /ZeroDivisionError/ },
  ],
  javascript: [
    { code: "console.log('hi', [1,2], {a: 1});\nawait new Promise(r => setTimeout(r, 50));\nconsole.log(readline());", stdin: "line1\n", out: "hi [ 1, 2 ] { a: 1 }\nline1\n", exit: 0 },
    { code: "throw new TypeError('boom')", exit: 1, err: /TypeError: boom/ },
  ],
  typescript: [{ code: "const x: number = 41;\ninterface P { n: number }\nconst p: P = { n: x + 1 };\nconsole.log(p.n);", out: "42\n", exit: 0 }],
  c: [
    { code: '#include <stdio.h>\nint main(void){ int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a * b); return 7; }', stdin: "6 7\n", out: "42\n", exit: 7 },
    { code: "int main(void){ return undefined_thing; }", exit: 1, err: /undeclared identifier/ },
    { code: "#include <stdlib.h>\nint main(void){ abort(); }", exit: 134 },
  ],
  cpp: [
    // The Hello example's ranges + range-for-with-initializer (libc++ has no views::enumerate yet).
    { code: '#include <algorithm>\n#include <iostream>\n#include <ranges>\n#include <string>\n#include <vector>\nint main() {\n    std::vector<std::string> langs{"rust", "go", "python", "c++"};\n    std::ranges::sort(langs);\n    for (std::size_t i = 0; const auto& lang : langs | std::views::take(10))\n        std::cout << i++ << ": " << lang << "\\n";\n}\n', out: "0: c++\n1: go\n2: python\n3: rust\n", exit: 0 },
    { code: '#include <iostream>\n#include <vector>\n#include <numeric>\nint main(){ std::vector<int> v(10); std::iota(v.begin(), v.end(), 1); std::cout << std::accumulate(v.begin(), v.end(), 0) << "\\n"; }', out: "55\n", exit: 0 },
  ],
  go: [
    { code: 'package main\n\nimport (\n\t"fmt"\n\t"strings"\n)\n\nfunc main() {\n\tfmt.Println(strings.Repeat("go", 3))\n}\n', out: "gogogo\n", exit: 0 },
    { code: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(x)\n}\n', exit: 1, err: /undefined: x/ },
  ],
  rust: [
    { code: 'fn main() {\n    let v: Vec<i32> = (1..=4).collect();\n    println!("{:?} {}", v, v.iter().sum::<i32>());\n}\n', out: "[1, 2, 3, 4] 10\n", exit: 0 },
    { code: "fn main() { let x: i32 = \"no\"; }", exit: 1, err: /mismatched types[\s\S]*--> main\.rs:1:26/ },
    { code: "fn main() { let v = vec![1]; println!(\"{}\", v[5]); }", exit: 134, err: /index out of bounds/ },
  ],
  java: [
    { code: 'void main() {\n    IO.println("hi " + java.util.List.of(1, 2, 3) + " é ✓ 😀");\n}\n', out: "hi [1, 2, 3] é ✓ 😀\n", exit: 0 },
    {
      code: "public class Hello {\n  public static void main(String[] args) throws Exception {\n    Thread t = new Thread(() -> System.out.println(\"thread\"));\n    t.start(); t.join();\n    Thread.sleep(50);\n    System.out.println(\"after sleep\");\n  }\n}\n",
      out: "thread\nafter sleep\n",
      exit: 0,
    },
    { code: "public class Main {\n  public static void main(String[] a) {\n    int x = \"s\";\n  }\n}\n", exit: 1, err: /Main\.java:3: error: incompatible types[\s\S]*\^[\s\S]*1 error/ },
    { code: "public class Main {\n  static void f() { throw new IllegalStateException(\"boom\"); }\n  public static void main(String[] a) { f(); }\n}\n", exit: 1, err: /Exception in thread "main" java\.lang\.IllegalStateException: boom\n\tat Main\.(f|main)\(Unknown Source\)/ },
    { code: 'void main() {\n  IO.println("compact");\n  throw new UnsupportedOperationException("nope");\n}\n', out: "compact\n", exit: 1, err: /Exception in thread "main" java\.lang\.UnsupportedOperationException: nope\n\tat Main\.main/ },
    { code: "public class Main {\n  public static void main(String[] a) {\n    String s = null;\n    System.out.println(\"before\");\n    System.out.println(s.length());\n  }\n}\n", out: "before\n", exit: 1, err: /java\.lang\.NullPointerException\n\tat Main\.main/ },
  ],
};

try {
  await goto(`${base}/python`);
  check("cross-origin isolated", await evaluate("crossOriginIsolated"));
  for (const [lang, cases] of Object.entries(CASES)) {
    if (only && !only.includes(lang)) continue;
    for (const [i, c] of cases.entries()) {
      const t = Date.now();
      try {
        const r = await evaluate(`window.playground.run(${JSON.stringify(lang)}, ${JSON.stringify(c.code)}, ${JSON.stringify(c.stdin ?? "")})`, 600000);
        const exit = r.result.type === "exit" ? r.result.code : r.result.type;
        const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
        const ok = exit === c.exit && (c.out === undefined || r.stdout === c.out) && (!c.err || c.err.test(plain(r.stderr)));
        check(
          `${lang} #${i + 1} (${((Date.now() - t) / 1000).toFixed(1)}s)`,
          ok,
          ok ? "" : `exit=${JSON.stringify(exit)} ${r.result.message ?? ""} stdout=${JSON.stringify(r.stdout.slice(0, 300))} stderr=${JSON.stringify(plain(r.stderr).slice(0, 600))}`,
        );
      } catch (e) {
        check(`${lang} #${i + 1}`, false, e.message.slice(0, 500));
      }
    }
  }

  // The UI: load the Go page with a share link, click Run, read the output pane.
  if (!only || only.includes("ui")) {
    const { encodeShare } = await import("../../app/lib/share.ts");
    await goto(`${base}/go#${encodeShare({ code: 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("from the ui") }\n' })}`);
    await sleep(500);
    await evaluate(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Run")).click()`);
    let text = "";
    for (let i = 0; i < 600 && !/exit \d/.test(text); i++) {
      await sleep(200);
      text = await evaluate(`document.querySelector('section[aria-label=Output]').innerText`);
    }
    check("ui: share link + Run button", text.includes("from the ui") && text.includes("exit 0"), text.slice(0, 200));

    // Stop: an infinite loop keeps running until Stop terminates the worker.
    await goto(`${base}/python#${encodeShare({ code: "while True:\n    pass\n" })}`);
    await sleep(500);
    await evaluate(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Run")).click()`);
    await sleep(4000);
    const stillRunning = await evaluate(`!![...document.querySelectorAll("button")].find(b => b.textContent.includes("Stop"))`);
    await evaluate(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Stop")).click()`);
    await sleep(300);
    text = await evaluate(`document.querySelector('section[aria-label=Output]').innerText`);
    check("ui: Stop halts an infinite loop", stillRunning && text.includes("stopped"), text.slice(0, 200));
  }
  check("no uncaught errors or CSP violations", errors.length === 0, errors.slice(0, 5).join(" | "));
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
