/**
 * A small in-memory filesystem for the WASI host. Engines (sysroots, standard libraries) are mounted into it, the
 * user's source is written into /work, and compilers write their output back. Nothing here touches the real disk.
 *
 * Files share their bytes when mounted (no copy), and copy on first write, so one sysroot can back many runs.
 */

export type FileNode = { kind: "file"; data: Uint8Array; size: number; shared: boolean; mtime: bigint };
export type DirNode = { kind: "dir"; entries: Map<string, Node>; mtime: bigint };
export type Node = FileNode | DirNode;

const now = () => BigInt(Date.now()) * 1_000_000n;

export const dir = (entries: [string, Node][] = []): DirNode => ({ kind: "dir", entries: new Map(entries), mtime: now() });
export const file = (data: Uint8Array | string = new Uint8Array(0), shared = true): FileNode => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return { kind: "file", data: bytes, size: bytes.length, shared, mtime: now() };
};

/** The live bytes of a file (a view, length = size). */
export const contents = (f: FileNode) => f.data.subarray(0, f.size);

/** Make room for `size` bytes, un-sharing the buffer first if it came from a mount. */
export function reserve(f: FileNode, size: number) {
  if (!f.shared && size <= f.data.length) return;
  const cap = Math.max(size, f.shared ? f.size : Math.min(f.data.length * 2, f.data.length + 64 * 1024 * 1024));
  const next = new Uint8Array(Math.max(cap, 256));
  next.set(f.data.subarray(0, f.size));
  f.data = next;
  f.shared = false;
}

export function writeAt(f: FileNode, offset: number, bytes: Uint8Array) {
  const end = offset + bytes.length;
  reserve(f, Math.max(end, f.size));
  f.data.set(bytes, offset);
  if (end > f.size) f.size = end;
  f.mtime = now();
}

export function truncate(f: FileNode, size: number) {
  if (size > f.size) {
    reserve(f, size);
    f.data.fill(0, f.size, size);
  } else if (f.shared) reserve(f, size);
  f.size = size;
  f.mtime = now();
}

/** Split a path into components, resolving "." and "..". Absolute and relative paths give the same result. */
export function parts(path: string): string[] {
  const out: string[] = [];
  for (const p of path.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out;
}

export function lookup(root: DirNode, path: string | string[]): Node | undefined {
  let cur: Node = root;
  for (const p of Array.isArray(path) ? path : parts(path)) {
    if (cur.kind !== "dir") return undefined;
    const next = cur.entries.get(p);
    if (!next) return undefined;
    cur = next;
  }
  return cur;
}

/** Create (or return) the directory at `path`, making parents as needed. */
export function mkdirp(root: DirNode, path: string | string[]): DirNode {
  let cur = root;
  for (const p of Array.isArray(path) ? path : parts(path)) {
    let next = cur.entries.get(p);
    if (!next) cur.entries.set(p, (next = dir()));
    if (next.kind !== "dir") throw new Error(`${p} is a file`);
    cur = next;
  }
  return cur;
}

/** Put a file at `path` (parents created). Strings are UTF-8 encoded. */
export function put(root: DirNode, path: string, data: Uint8Array | string) {
  const ps = parts(path);
  const name = ps.pop()!;
  mkdirp(root, ps).entries.set(name, file(data, typeof data !== "string"));
}

export function read(root: DirNode, path: string): Uint8Array | undefined {
  const n = lookup(root, path);
  return n?.kind === "file" ? contents(n) : undefined;
}

/** Parse a ustar/GNU tar archive (as produced by our engine build) and mount it at `at`. */
export function mountTar(root: DirNode, at: string, tar: Uint8Array) {
  const base = mkdirp(root, at);
  const dec = new TextDecoder();
  const field = (o: number, n: number) => {
    const s = dec.decode(tar.subarray(o, o + n));
    const z = s.indexOf("\0");
    return z < 0 ? s : s.slice(0, z);
  };
  let off = 0;
  let longName: string | null = null;
  while (off + 512 <= tar.length) {
    if (tar[off] === 0) break;
    let name = field(off, 100);
    const size = parseInt(field(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[off + 156] || 48);
    const prefix = field(off + 345, 155);
    if (prefix && tar[off + 257] === 0x75 /* ustar */) name = `${prefix}/${name}`;
    const body = off + 512;
    if (type === "L") longName = field(body, size);
    else if (type !== "x" && type !== "g") {
      if (longName) (name = longName), (longName = null);
      if (type === "5") mkdirp(base, name);
      else if (type === "0" || type === "7") {
        const ps = parts(name);
        const leaf = ps.pop();
        if (leaf) mkdirp(base, ps).entries.set(leaf, file(tar.subarray(body, body + size)));
      }
    }
    off = body + Math.ceil(size / 512) * 512;
  }
}
