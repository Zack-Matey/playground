/**
 * Fetching engines from /engines/<id>-<version>/ with progress. Responses are cached by the browser (immutable URLs)
 * and by the service worker; compiled WebAssembly modules are kept in memory for as long as the runner worker lives,
 * so the second run of a language starts immediately.
 */
import { engineBase, type EngineId } from "config/engines";

export type Progress = (label: string, loaded: number, total: number) => void;

const bytesCache = new Map<string, Promise<Uint8Array>>();
const moduleCache = new Map<string, Promise<WebAssembly.Module>>();

export const engineUrl = (id: EngineId, file: string) => `${engineBase(id)}/${file}`;

export function fetchBytes(url: string, label: string, progress?: Progress): Promise<Uint8Array> {
  let p = bytesCache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Couldn't load ${url} (HTTP ${res.status})`);
      // With Content-Encoding the header is the compressed size; it still makes a fair progress bar.
      const total = Number(res.headers.get("content-length")) || 0;
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        progress?.(label, loaded, Math.max(total, loaded));
      }
      const out = new Uint8Array(loaded);
      let o = 0;
      for (const c of chunks) out.set(c, o), (o += c.length);
      return out;
    })();
    p.catch(() => bytesCache.delete(url));
    bytesCache.set(url, p);
  }
  return p;
}

export function fetchModule(url: string, label: string, progress?: Progress): Promise<WebAssembly.Module> {
  let p = moduleCache.get(url);
  if (!p) {
    p = fetchBytes(url, label, progress).then((b) => {
      bytesCache.delete(url); // the compiled module is all we need; let the bytes go
      return WebAssembly.compile(b as BufferSource);
    });
    p.catch(() => moduleCache.delete(url));
    moduleCache.set(url, p);
  }
  return p;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}
