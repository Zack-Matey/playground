// Dev helper: print a wasm module's imports, including memory limits (initial/maximum pages, shared).
import { readFileSync } from "node:fs";
const b = readFileSync(process.argv[2]);
let p = 8;
const leb = () => { let r = 0, s = 0, x; do { x = b[p++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return r >>> 0; };
const str = () => { const n = leb(); const s = b.toString("utf8", p, p + n); p += n; return s; };
while (p < b.length) {
  const id = b[p++], size = leb(), end = p + size;
  if (id === 2) {
    const n = leb();
    for (let i = 0; i < n; i++) {
      const m = str(), f = str(), kind = b[p++];
      if (kind === 0) { leb(); continue; }
      if (kind === 2) { const fl = b[p++]; const min = leb(); const max = fl & 1 ? leb() : undefined; console.log(`${m}.${f} memory min=${min} max=${max} shared=${!!(fl & 2)}`); }
      else console.log(`${m}.${f} kind=${kind}`), p = end;
    }
    break;
  }
  p = end;
}
