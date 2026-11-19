import { describe, expect, it } from "vitest";
import { initialAnsi, parseAnsi } from "app/lib/ansi";
import { decodeShare, encodeShare } from "app/lib/share";
import { closure, goImports } from "app/run/langs/go";
import { parseLinkArgs, withoutLinkerError } from "app/run/langs/rust";
import { formatDiagnostic, javaFileName, launcherSource, trapException, wrapCompact } from "app/run/langs/java";
import { javaFrames } from "app/run/langs/teavm";
import { LANGUAGES } from "app/lib/languages";

describe("ansi", () => {
  it("styles SGR runs and keeps state across chunks", () => {
    const st = initialAnsi();
    const a = parseAnsi("\x1b[1m\x1b[31merror", 2, st);
    expect(a).toEqual([{ text: "error", cls: "ansi-1 ansi-fg-1", fd: 2 }]);
    const b = parseAnsi(": bad\x1b[0m ok", 2, st);
    expect(b).toEqual([
      { text: ": bad", cls: "ansi-1 ansi-fg-1", fd: 2 },
      { text: " ok", cls: "", fd: 2 },
    ]);
  });
  it("drops cursor movement and OSC links", () => {
    expect(parseAnsi("a\x1b[2Kb\x1b]8;;https://x\x07c", 1, initialAnsi()).map((s) => s.text).join("")).toBe("abc");
  });
});

describe("share links", () => {
  it("round-trips code and stdin, including unicode", () => {
    const s = { code: "print('héllo 👋')\n".repeat(50), stdin: "1 2\n" };
    expect(decodeShare("#" + encodeShare(s))).toEqual(s);
    expect(decodeShare("#" + encodeShare({ code: "x" }))).toEqual({ code: "x", stdin: undefined });
  });
  it("rejects junk", () => {
    expect(decodeShare("#code=!!!")).toBeNull();
    expect(decodeShare("#other=1")).toBeNull();
  });
});

describe("go imports", () => {
  it("parses single, grouped, aliased and commented imports", () => {
    const src = `package main
// import "fake/comment"
import "fmt"
import (
	str "strings"
	_ "embed"
	. "math"
	/* "fake/block" */
	"net/http" // web
)
func main() { fmt.Println("import \\"not/real\\"") }`;
    expect(goImports(src).sort()).toEqual(["embed", "fmt", "math", "net/http", "strings"]);
  });
  it("orders dependencies first and skips packages without archives (unsafe)", () => {
    const pkgs = { runtime: ["internal/abi", "unsafe"], "internal/abi": [], fmt: ["runtime", "strconv"], strconv: ["runtime"] };
    const order = closure(pkgs, ["runtime", "fmt"]);
    expect(order).toEqual(["internal/abi", "runtime", "strconv", "fmt"]);
  });
});

describe("rust linking", () => {
  it("extracts the linker arguments rustc prints", () => {
    const printed = `LC_ALL="C" PATH="/x" VSLANG="1033" "rust-lld" "-flavor" "wasm" "--export" "__main_void" "-z" "stack-size=1048576" "/work/main.main.abc-cgu.0.rcgu.o" "-L" "/sysroot/lib/rustlib/wasm32-wasip1/lib/self-contained" "-o" "/work/main.wasm"\n`;
    expect(parseLinkArgs(printed)).toEqual(["--export", "__main_void", "-z", "stack-size=1048576", "/work/main.main.abc-cgu.0.rcgu.o", "-L", "/sysroot/lib/rustlib/wasm32-wasip1/lib/self-contained", "-o", "/work/main.wasm"]);
    expect(parseLinkArgs("nothing here")).toBeNull();
  });
  it("hides only rustc's complaint about the missing linker", () => {
    const err = "\x1b[33mwarning\x1b[0m: unused variable: `x`\n --> main.rs:1:5\n\n\x1b[31merror\x1b[0m: linker `rust-lld` not found\n  |\n  = note: No such file\n\nerror: aborting due to 1 previous error\n";
    const shown = withoutLinkerError(err).replace(/\x1b\[[0-9;]*m/g, "");
    expect(shown).toContain("warning: unused variable");
    expect(shown).not.toContain("linker");
    expect(shown).not.toContain("aborting");
  });
});

describe("languages", () => {
  it("every language has examples and a unique file name", () => {
    expect(new Set(LANGUAGES.map((l) => l.file)).size).toBe(LANGUAGES.length);
    for (const l of LANGUAGES) expect(l.examples.length).toBeGreaterThan(0);
  });
});

describe("java", () => {
  it("names the file after the public top-level type", () => {
    expect(javaFileName("// public class Nope\npublic final class Hello {}")).toBe("Hello.java");
    expect(javaFileName("void main() {}")).toBe("Main.java");
    expect(javaFileName("public record Point(int x) {}")).toBe("Point.java");
  });

  it("launches every main form Java 25 allows", () => {
    expect(launcherSource("Main", [{ isStatic: true, takesArgs: true }])).toContain("Main.main(args);");
    expect(launcherSource("Main", [{ isStatic: false, takesArgs: false }])).toContain("new Main().main();");
    expect(launcherSource("a.B", [{ isStatic: false, takesArgs: false }, { isStatic: true, takesArgs: true }])).toContain("a.B.main(args);");
    expect(launcherSource("Main", [])).toBeNull();
  });

  it("wraps a compact source file without moving its lines", () => {
    expect(wrapCompact("import java.util.*;\n\n// hi\nvoid main() {\n}\n")).toBe("import java.util.*;\n\n// hi\nimport module java.base; final class Main { void main() {\n}\n\n}\n");
  });

  it("prints diagnostics like javac", () => {
    const d = { type: "javac" as const, severity: "error" as const, fileName: "Main.java", lineNumber: 2, columnNumber: 13, message: "cannot find symbol\n  symbol: foo" };
    expect(formatDiagnostic(d, "class Main {\n\tint x = foo;\n}")).toBe("Main.java:2: error: cannot find symbol\n\tint x = foo;\n\t           ^\n  symbol: foo\n");
  });

  it("maps traps to the exception the JVM would throw", () => {
    expect(trapException(new WebAssembly.RuntimeError("dereferencing a null pointer"))).toBe("java.lang.NullPointerException");
    expect(trapException(new WebAssembly.RuntimeError("integer divide by zero"))).toBe("java.lang.ArithmeticException: / by zero");
    expect(trapException(new RangeError("Maximum call stack size exceeded"))).toBe("java.lang.StackOverflowError");
    expect(trapException(new Error("x"))).toBeNull();
  });

  it("reads Java frames from a JS stack", () => {
    const stack = [
      "Error",
      "    at decorateException (file:///teavm.js:1:1)",
      "    at java.lang.Throwable::fillInStackTrace (wasm://wasm/1:wasm-function[1]:0x1)",
      "    at java.lang.RuntimeException::<init>_0 (wasm://wasm/1:wasm-function[2]:0x2)",
      "    at Main::inner_1 (wasm://wasm/1:wasm-function[3]:0x3)",
      "    at __PlaygroundLauncher::main (wasm://wasm/1:wasm-function[4]:0x4)",
      "    at org.teavm.runtime.Fiber::startMain (wasm://wasm/1:wasm-function[5]:0x5)",
    ].join("\n");
    expect(javaFrames(stack, /^__PlaygroundLauncher$/).map((f) => `${f.className}.${f.method}`)).toEqual(["Main.inner"]);
  });
});
