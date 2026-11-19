// Dev helper: drive the Java engine (javac + TeaVM, public/engines/java-*) from Node through the same CSP-safe
// loader the site uses (app/run/langs/teavm.ts), so an @JSBody snippet missing from teavm-jsbody.ts fails here too.
//   node scripts/dev/teavm-probe.mjs File.java…
// Prints diagnostics, timings, and each compiled program's imports, exports and output.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENGINES } from "../../config/engines.ts";
import { compileTeaVM, loadTeaVM } from "../../app/run/langs/teavm.ts";
import { compilerJsBody, programJsBody } from "../../app/run/langs/teavm-jsbody.ts";
import { mainMethods } from "../../app/run/langs/classfile.ts";

const root = path.resolve(import.meta.dirname, "../..");
const dir = path.join(root, "public/engines", `java-${ENGINES.java.version}`);

let t = performance.now();
const lap = (label) => (console.log(`[${label}] ${(performance.now() - t).toFixed(0)} ms`), (t = performance.now()));
const teavm = await loadTeaVM(await compileTeaVM(readFileSync(path.join(dir, "compiler.wasm"))), { jsBody: compilerJsBody });
lap("load compiler");
const c = teavm.exports.createCompiler();
c.setSdk(new Int8Array(readFileSync(path.join(dir, "compile-classlib-teavm.bin"))));
c.setTeaVMClasslib(new Int8Array(readFileSync(path.join(dir, "runtime-classlib-teavm.bin"))));
lap("classlibs");
c.onDiagnostic((d) => console.log(`  diag ${d.type} ${d.severity} ${d.fileName}:${d.lineNumber}:${d.columnNumber} ${d.message}`));

for (const f of process.argv.slice(2)) {
  console.log(`=== ${f}`);
  c.clearSourceFiles();
  c.clearOutputFiles();
  c.addSourceFile("Main.java", readFileSync(f, "utf8"));
  const ok = c.compile();
  lap(`javac ok=${ok}`);
  if (!ok) continue;
  const mains = [...c.detectMainClasses()];
  console.log("  mains:", mains, "outputs:", [...c.listOutputFiles()]);
  for (const m of mains) console.log(`  ${m} main methods:`, mainMethods(c.getOutputFile(`${m.replace(/\./g, "/")}.class`)));
  const ok2 = await c.generateWebAssembly({ outputName: "app", mainClass: "Main", obfuscated: false, strictMode: true });
  lap(`teavm ok=${ok2}`);
  if (!ok2) continue;
  console.log("  outputs:", [...c.listWebAssemblyOutputFiles()]);
  const wasm = c.getWebAssemblyOutputFile("app.wasm");
  const mod = await compileTeaVM(wasm);
  const by = {};
  for (const i of WebAssembly.Module.imports(mod)) (by[i.module] ??= []).push(i.name);
  console.log(`  app.wasm ${wasm.length} bytes; imports ${JSON.stringify(by)}`);
  console.log("  exports:", WebAssembly.Module.exports(mod).map((e) => `${e.name}:${e.kind}`).join(" "));
  const put = (stream) => (ch) => stream.write(String.fromCharCode(ch));
  const app = await loadTeaVM(mod, {
    jsBody: (params, body) => (console.log("  program @JSBody", JSON.stringify([params, body])), programJsBody(params, body)),
    installImports(o) {
      o.teavmConsole.putcharStdout = put(process.stdout);
      o.teavmConsole.putcharStderr = put(process.stderr);
    },
  });
  lap("instantiate program");
  try {
    console.log("\n  main returned", app.exports.main([]));
  } catch (e) {
    console.log("\n  main threw", e?.constructor?.name, String(e?.message ?? e).slice(0, 300));
    if (process.env.STACK) console.log(String(e?.stack).split("\n").slice(0, 25).join("\n"));
  }
  lap("run (synchronous part)");
  await new Promise((r) => setTimeout(r, 300));
}
