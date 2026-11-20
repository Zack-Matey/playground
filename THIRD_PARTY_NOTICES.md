# Third-party notices

The code in this repository is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only, see [LICENSE](LICENSE)), except for the material below, which keeps its own license.

## Included in this repository

| What | Where | License |
|---|---|---|
| Geist and Geist Mono fonts, © The Geist Project Authors | `public/fonts/` | SIL Open Font License 1.1: [licenses/Geist-OFL-1.1.txt](licenses/Geist-OFL-1.1.txt) |
| Java logo paths from Devicon (`java-original`), © 2015 konpa | `app/components/language-icons.tsx` | MIT: [licenses/Devicon-MIT.txt](licenses/Devicon-MIT.txt) |
| Port of TeaVM's WebAssembly runtime JavaScript, © Alexey Andreev | `app/run/langs/teavm.ts` | Apache-2.0: [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt), notice in [NOTICE](NOTICE) |

The language logos name the languages they belong to. They are trademarks of their owners (Java is a trademark of Oracle, the Rust logo belongs to the Rust Foundation, and so on), and their use here doesn't imply endorsement.

## Engines and dependencies, not in this repository

`npm install` and `npm run fetch-engines` fetch these (engines go to `public/engines/`, which is git-ignored), and the deployed site serves them to visitors. Each is distributed under its own license:

| Engine | License | Source |
|---|---|---|
| Pyodide (CPython) | MPL-2.0 (CPython: PSF-2.0) | https://github.com/pyodide/pyodide |
| quickjs-emscripten (QuickJS) | MIT | https://github.com/justjake/quickjs-emscripten |
| Sucrase | MIT | https://github.com/alangpierce/sucrase |
| YoWASP Clang (LLVM, Clang, LLD, wasi-libc, libc++) | Apache-2.0 WITH LLVM-exception, plus the wasi-libc licenses | https://github.com/YoWASP/clang |
| Go compiler, linker and standard library | BSD-3-Clause | https://go.googlesource.com/go |
| rust_wasm (rustc, Rust std) | MIT / Apache-2.0 | https://github.com/oligamiq/rust_wasm |
| teavm-javac: javac from OpenJDK | GPL-2.0 WITH Classpath-exception-2.0 | https://github.com/konsoletyper/teavm-javac, https://github.com/openjdk/jdk |
| teavm-javac: TeaVM compiler and class library | Apache-2.0 | https://github.com/konsoletyper/teavm |
| CodeMirror and the other npm dependencies | see each package in `node_modules` | `package.json` |

The engines are separate programs that the site loads at runtime. They aren't linked into this repository's code, and their licenses don't extend to it.
