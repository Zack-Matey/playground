/**
 * WASI preview 1 over the in-memory filesystem in ./fs.ts.
 *
 * One implementation serves two callers:
 *  - single-threaded modules (compiled user programs, the Go compiler and linker) call these functions directly;
 *  - threaded modules (rustc) run in worker threads that forward each call here over shared memory (./threads.ts).
 * So every function takes plain numbers or BigInts and reads/writes guest memory through `this.memory`, which may be a
 * SharedArrayBuffer. Shared buffers can't be handed to TextDecoder or crypto, so those paths copy first.
 */
import { contents, dir, file, lookup, parts, truncate, writeAt, type DirNode, type FileNode, type Node } from "./fs";

export const E = {
  SUCCESS: 0, ACCES: 2, AGAIN: 6, BADF: 8, EXIST: 20, FAULT: 21, INVAL: 28, IO: 29, ISDIR: 31, NAMETOOLONG: 37,
  NOENT: 44, NOSYS: 52, NOTDIR: 54, NOTEMPTY: 55, NOTSUP: 58, PERM: 63, SPIPE: 70, NOTCAPABLE: 76,
} as const;

const FT = { UNKNOWN: 0, CHAR: 2, DIR: 3, REG: 4 } as const;
const OFLAGS = { CREAT: 1, DIRECTORY: 2, EXCL: 4, TRUNC: 8 } as const;
const FDFLAG_APPEND = 1;

export class Exit extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

type Fd =
  | { kind: "stdin" | "stdout" | "stderr" }
  | { kind: "file"; node: FileNode; pos: number; append: boolean; path: string[] }
  | { kind: "dir"; node: DirNode; path: string[]; preopen?: string };

type Num = number | bigint;
const u32 = (x: Num) => (typeof x === "bigint" ? Number(BigInt.asUintN(32, x)) : x >>> 0);
const i64 = (x: Num) => (typeof x === "bigint" ? Number(BigInt.asIntN(64, x)) : x);
const u64 = (x: Num) => (typeof x === "bigint" ? Number(BigInt.asUintN(64, x)) : x);

export type WasiOptions = {
  args: string[];
  env?: Record<string, string>;
  root: DirNode;
  /** Guest paths to pre-open as directories (the first is fd 3). Default: just "/". */
  preopens?: string[];
  stdin?: Uint8Array;
  /** Called with a copy of every write to fd 1 or 2. */
  onOutput: (fd: 1 | 2, bytes: Uint8Array) => void;
};

export class Wasi {
  memory: WebAssembly.Memory | null = null;
  private fds: (Fd | undefined)[] = [];
  private args: Uint8Array[];
  private env: Uint8Array[];
  private stdin: Uint8Array;
  private stdinPos = 0;
  private enc = new TextEncoder();
  private dec = new TextDecoder();
  private sleeper: Int32Array | null = null;

  constructor(private opts: WasiOptions) {
    this.args = opts.args.map((a) => this.enc.encode(a + "\0"));
    this.env = Object.entries(opts.env ?? {}).map(([k, v]) => this.enc.encode(`${k}=${v}\0`));
    this.stdin = opts.stdin ?? new Uint8Array(0);
    this.fds = [{ kind: "stdin" }, { kind: "stdout" }, { kind: "stderr" }];
    for (const p of opts.preopens ?? ["/"]) {
      const node = lookup(opts.root, p);
      if (node?.kind !== "dir") throw new Error(`preopen ${p} is not a directory`);
      this.fds.push({ kind: "dir", node, path: parts(p), preopen: p });
    }
  }

  // ---------- memory helpers ----------
  private get buf() {
    return this.memory!.buffer;
  }
  private dv() {
    return new DataView(this.buf);
  }
  private bytes(ptr: number, len: number) {
    return new Uint8Array(this.buf, ptr, len);
  }
  private str(ptr: Num, len: Num) {
    return this.dec.decode(this.bytes(u32(ptr), u32(len)).slice());
  }
  private iovs(ptr: Num, len: Num): [number, number][] {
    const dv = this.dv();
    const out: [number, number][] = [];
    for (let i = 0, p = u32(ptr); i < u32(len); i++, p += 8) out.push([dv.getUint32(p, true), dv.getUint32(p + 4, true)]);
    return out;
  }

  /** Run a command module's _start. Returns the exit code. */
  start(instance: WebAssembly.Instance): number {
    if (!this.memory) this.memory = instance.exports.memory as WebAssembly.Memory;
    try {
      (instance.exports._start as () => void)();
      return 0;
    } catch (e) {
      if (e instanceof Exit) return e.code;
      throw e;
    }
  }

  /** The import object for `wasi_snapshot_preview1`. Names the module asks for that we don't implement return ENOSYS. */
  imports(module?: WebAssembly.Module): Record<string, (...a: never[]) => number> {
    const fns = this.fns as unknown as Record<string, (...a: never[]) => number>;
    const out: Record<string, (...a: never[]) => number> = { ...fns };
    if (module)
      for (const imp of WebAssembly.Module.imports(module))
        if (imp.module === "wasi_snapshot_preview1" && !(imp.name in out)) out[imp.name] = () => E.NOSYS;
    return out;
  }

  /** Resolve a path relative to a directory fd into absolute components. */
  private resolve(fd: Num, ptr: Num, len: Num): { abs: string[]; err?: number } {
    const d = this.fds[u32(fd)];
    if (!d) return { abs: [], err: E.BADF };
    if (d.kind !== "dir") return { abs: [], err: E.NOTDIR };
    const p = this.str(ptr, len);
    return { abs: parts([...d.path, ...p.split("/")].join("/")) };
  }

  private writeFilestat(ptr: number, node: Node | "char") {
    const dv = this.dv();
    for (let i = 0; i < 64; i += 8) dv.setBigUint64(ptr + i, 0n, true);
    dv.setBigUint64(ptr + 8, 1n, true);
    dv.setUint8(ptr + 16, node === "char" ? FT.CHAR : node.kind === "dir" ? FT.DIR : FT.REG);
    dv.setBigUint64(ptr + 24, 1n, true);
    if (node !== "char") {
      dv.setBigUint64(ptr + 32, BigInt(node.kind === "file" ? node.size : 4096), true);
      for (const o of [40, 48, 56]) dv.setBigUint64(ptr + o, node.mtime, true);
    }
  }

  private sleep(ms: number) {
    if (ms <= 0) return;
    try {
      this.sleeper ??= new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(this.sleeper, 0, 0, ms);
    } catch {
      const end = performance.now() + ms;
      while (performance.now() < end);
    }
  }

  readonly fns = {
    args_sizes_get: (argc: Num, size: Num) => {
      const dv = this.dv();
      dv.setUint32(u32(argc), this.args.length, true);
      dv.setUint32(u32(size), this.args.reduce((n, a) => n + a.length, 0), true);
      return E.SUCCESS;
    },
    args_get: (argv: Num, buf: Num) => this.writeStrings(this.args, u32(argv), u32(buf)),
    environ_sizes_get: (count: Num, size: Num) => {
      const dv = this.dv();
      dv.setUint32(u32(count), this.env.length, true);
      dv.setUint32(u32(size), this.env.reduce((n, a) => n + a.length, 0), true);
      return E.SUCCESS;
    },
    environ_get: (environ: Num, buf: Num) => this.writeStrings(this.env, u32(environ), u32(buf)),

    clock_res_get: (_id: Num, res: Num) => {
      this.dv().setBigUint64(u32(res), 1000n, true);
      return E.SUCCESS;
    },
    clock_time_get: (id: Num, _precision: Num, out: Num) => {
      const t = u32(id) === 0 ? BigInt(Date.now()) * 1_000_000n : BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6));
      this.dv().setBigUint64(u32(out), t, true);
      return E.SUCCESS;
    },

    fd_advise: () => E.SUCCESS,
    fd_allocate: (fd: Num, off: Num, len: Num) => {
      const f = this.fds[u32(fd)];
      if (f?.kind !== "file") return E.BADF;
      const end = u64(off) + u64(len);
      if (end > f.node.size) truncate(f.node, end);
      return E.SUCCESS;
    },
    fd_close: (fd: Num) => {
      const n = u32(fd);
      if (!this.fds[n]) return E.BADF;
      this.fds[n] = undefined;
      return E.SUCCESS;
    },
    fd_datasync: () => E.SUCCESS,
    fd_sync: () => E.SUCCESS,
    fd_fdstat_get: (fd: Num, ptr: Num) => {
      const f = this.fds[u32(fd)];
      if (!f) return E.BADF;
      const dv = this.dv();
      const p = u32(ptr);
      dv.setUint8(p, f.kind === "dir" ? FT.DIR : f.kind === "file" ? FT.REG : FT.CHAR);
      dv.setUint16(p + 2, f.kind === "file" && f.append ? FDFLAG_APPEND : 0, true);
      dv.setBigUint64(p + 8, 0xffff_ffff_ffff_ffffn, true);
      dv.setBigUint64(p + 16, 0xffff_ffff_ffff_ffffn, true);
      return E.SUCCESS;
    },
    fd_fdstat_set_flags: (fd: Num, flags: Num) => {
      const f = this.fds[u32(fd)];
      if (!f) return E.BADF;
      if (f.kind === "file") f.append = (u32(flags) & FDFLAG_APPEND) !== 0;
      return E.SUCCESS;
    },
    fd_fdstat_set_rights: () => E.SUCCESS,
    fd_filestat_get: (fd: Num, ptr: Num) => {
      const f = this.fds[u32(fd)];
      if (!f) return E.BADF;
      this.writeFilestat(u32(ptr), f.kind === "file" || f.kind === "dir" ? f.node : "char");
      return E.SUCCESS;
    },
    fd_filestat_set_size: (fd: Num, size: Num) => {
      const f = this.fds[u32(fd)];
      if (f?.kind !== "file") return E.BADF;
      truncate(f.node, u64(size));
      return E.SUCCESS;
    },
    fd_filestat_set_times: () => E.SUCCESS,
    fd_prestat_get: (fd: Num, ptr: Num) => {
      const f = this.fds[u32(fd)];
      if (!f || f.kind !== "dir" || f.preopen === undefined) return E.BADF;
      const dv = this.dv();
      dv.setUint8(u32(ptr), 0);
      dv.setUint32(u32(ptr) + 4, this.enc.encode(f.preopen).length, true);
      return E.SUCCESS;
    },
    fd_prestat_dir_name: (fd: Num, ptr: Num, len: Num) => {
      const f = this.fds[u32(fd)];
      if (!f || f.kind !== "dir" || f.preopen === undefined) return E.BADF;
      this.bytes(u32(ptr), u32(len)).set(this.enc.encode(f.preopen).subarray(0, u32(len)));
      return E.SUCCESS;
    },
    fd_read: (fd: Num, iovs: Num, iovsLen: Num, nread: Num) => this.readv(u32(fd), iovs, iovsLen, nread, null),
    fd_pread: (fd: Num, iovs: Num, iovsLen: Num, offset: Num, nread: Num) => this.readv(u32(fd), iovs, iovsLen, nread, u64(offset)),
    fd_write: (fd: Num, iovs: Num, iovsLen: Num, nwritten: Num) => this.writev(u32(fd), iovs, iovsLen, nwritten, null),
    fd_pwrite: (fd: Num, iovs: Num, iovsLen: Num, offset: Num, nwritten: Num) => this.writev(u32(fd), iovs, iovsLen, nwritten, u64(offset)),
    fd_readdir: (fd: Num, buf: Num, bufLen: Num, cookie: Num, used: Num) => {
      const f = this.fds[u32(fd)];
      if (!f) return E.BADF;
      if (f.kind !== "dir") return E.NOTDIR;
      const names = [".", "..", ...f.node.entries.keys()];
      const chunks: Uint8Array[] = [];
      let total = 0;
      const cap = u32(bufLen);
      for (let i = u64(cookie); i < names.length && total < cap; i++) {
        const name = this.enc.encode(names[i]);
        const node = i < 2 ? f.node : f.node.entries.get(names[i])!;
        const ent = new Uint8Array(24 + name.length);
        const dv = new DataView(ent.buffer);
        dv.setBigUint64(0, BigInt(i + 1), true);
        dv.setBigUint64(8, BigInt(i + 1), true);
        dv.setUint32(16, name.length, true);
        dv.setUint8(20, node.kind === "dir" ? FT.DIR : FT.REG);
        ent.set(name, 24);
        chunks.push(ent);
        total += ent.length;
      }
      const out = this.bytes(u32(buf), cap);
      let p = 0;
      for (const c of chunks) {
        const n = Math.min(c.length, cap - p);
        out.set(c.subarray(0, n), p);
        p += n;
      }
      this.dv().setUint32(u32(used), p, true);
      return E.SUCCESS;
    },
    fd_renumber: (from: Num, to: Num) => {
      const f = this.fds[u32(from)];
      if (!f) return E.BADF;
      this.fds[u32(to)] = f;
      this.fds[u32(from)] = undefined;
      return E.SUCCESS;
    },
    fd_seek: (fd: Num, offset: Num, whence: Num, out: Num) => {
      const f = this.fds[u32(fd)];
      if (!f) return E.BADF;
      if (f.kind !== "file") return f.kind === "dir" ? E.ISDIR : E.SPIPE;
      const w = u32(whence);
      const base = w === 0 ? 0 : w === 1 ? f.pos : f.node.size;
      const pos = base + i64(offset);
      if (pos < 0) return E.INVAL;
      f.pos = pos;
      this.dv().setBigUint64(u32(out), BigInt(pos), true);
      return E.SUCCESS;
    },
    fd_tell: (fd: Num, out: Num) => {
      const f = this.fds[u32(fd)];
      if (f?.kind !== "file") return E.BADF;
      this.dv().setBigUint64(u32(out), BigInt(f.pos), true);
      return E.SUCCESS;
    },

    path_create_directory: (fd: Num, ptr: Num, len: Num) => {
      const { abs, err } = this.resolve(fd, ptr, len);
      if (err) return err;
      const name = abs.pop();
      const parent = lookup(this.opts.root, abs);
      if (!name || parent?.kind !== "dir") return E.NOENT;
      if (parent.entries.has(name)) return E.EXIST;
      parent.entries.set(name, dir());
      return E.SUCCESS;
    },
    path_filestat_get: (fd: Num, _flags: Num, ptr: Num, len: Num, out: Num) => {
      const { abs, err } = this.resolve(fd, ptr, len);
      if (err) return err;
      const node = lookup(this.opts.root, abs);
      if (!node) return E.NOENT;
      this.writeFilestat(u32(out), node);
      return E.SUCCESS;
    },
    path_filestat_set_times: () => E.SUCCESS,
    path_link: () => E.NOTSUP,
    path_symlink: () => E.NOTSUP,
    path_readlink: (fd: Num, ptr: Num, len: Num) => {
      const { abs, err } = this.resolve(fd, ptr, len);
      if (err) return err;
      return lookup(this.opts.root, abs) ? E.INVAL : E.NOENT;
    },
    path_open: (dirfd: Num, _dirflags: Num, ptr: Num, len: Num, oflags: Num, _rb: Num, _ri: Num, fdflags: Num, out: Num) => {
      const { abs, err } = this.resolve(dirfd, ptr, len);
      if (err) return err;
      const o = u32(oflags);
      let node = lookup(this.opts.root, abs);
      if (node && o & OFLAGS.EXCL && o & OFLAGS.CREAT) return E.EXIST;
      if (!node) {
        if (!(o & OFLAGS.CREAT)) return E.NOENT;
        const name = abs[abs.length - 1];
        const parent = lookup(this.opts.root, abs.slice(0, -1));
        if (!name || parent?.kind !== "dir") return E.NOENT;
        node = file(new Uint8Array(0), false);
        parent.entries.set(name, node);
      }
      if (o & OFLAGS.DIRECTORY && node.kind !== "dir") return E.NOTDIR;
      if (node.kind === "file" && o & OFLAGS.TRUNC) truncate(node, 0);
      const fd = this.nextFd();
      this.fds[fd] =
        node.kind === "dir"
          ? { kind: "dir", node, path: abs }
          : { kind: "file", node, pos: 0, append: (u32(fdflags) & FDFLAG_APPEND) !== 0, path: abs };
      this.dv().setUint32(u32(out), fd, true);
      return E.SUCCESS;
    },
    path_remove_directory: (fd: Num, ptr: Num, len: Num) => {
      const { abs, err } = this.resolve(fd, ptr, len);
      if (err) return err;
      const node = lookup(this.opts.root, abs);
      if (!node) return E.NOENT;
      if (node.kind !== "dir") return E.NOTDIR;
      if (node.entries.size) return E.NOTEMPTY;
      (lookup(this.opts.root, abs.slice(0, -1)) as DirNode).entries.delete(abs[abs.length - 1]);
      return E.SUCCESS;
    },
    path_rename: (fd: Num, op: Num, ol: Num, nfd: Num, np: Num, nl: Num) => {
      const a = this.resolve(fd, op, ol);
      const b = this.resolve(nfd, np, nl);
      if (a.err || b.err) return a.err || b.err!;
      const src = lookup(this.opts.root, a.abs);
      const dst = lookup(this.opts.root, b.abs.slice(0, -1));
      if (!src) return E.NOENT;
      if (dst?.kind !== "dir") return E.NOENT;
      (lookup(this.opts.root, a.abs.slice(0, -1)) as DirNode).entries.delete(a.abs[a.abs.length - 1]);
      dst.entries.set(b.abs[b.abs.length - 1], src);
      return E.SUCCESS;
    },
    path_unlink_file: (fd: Num, ptr: Num, len: Num) => {
      const { abs, err } = this.resolve(fd, ptr, len);
      if (err) return err;
      const node = lookup(this.opts.root, abs);
      if (!node) return E.NOENT;
      if (node.kind === "dir") return E.ISDIR;
      (lookup(this.opts.root, abs.slice(0, -1)) as DirNode).entries.delete(abs[abs.length - 1]);
      return E.SUCCESS;
    },

    poll_oneoff: (inPtr: Num, outPtr: Num, nsubs: Num, nevents: Num) => {
      const dv = this.dv();
      const n = u32(nsubs);
      let wait = Infinity;
      let clockSub = -1;
      const ready: number[] = [];
      for (let i = 0; i < n; i++) {
        const s = u32(inPtr) + i * 48;
        const tag = dv.getUint8(s + 8);
        if (tag === 0) {
          const timeout = Number(dv.getBigUint64(s + 24, true)) / 1e6;
          const abs = dv.getUint16(s + 40, true) & 1;
          const ms = abs ? timeout - Date.now() : timeout;
          if (ms < wait) (wait = ms), (clockSub = i);
        } else ready.push(i);
      }
      if (!ready.length && clockSub >= 0) {
        this.sleep(wait);
        ready.push(clockSub);
      }
      let p = u32(outPtr);
      for (const i of ready) {
        const s = u32(inPtr) + i * 48;
        dv.setBigUint64(p, dv.getBigUint64(s, true), true);
        dv.setUint16(p + 8, 0, true);
        dv.setUint8(p + 10, dv.getUint8(s + 8));
        dv.setBigUint64(p + 16, BigInt(dv.getUint8(s + 8) === 1 ? this.stdin.length - this.stdinPos : 0), true);
        dv.setUint16(p + 24, 0, true);
        p += 32;
      }
      dv.setUint32(u32(nevents), ready.length, true);
      return E.SUCCESS;
    },
    proc_exit: (code: Num) => {
      throw new Exit(u32(code));
    },
    proc_raise: () => E.NOSYS,
    sched_yield: () => E.SUCCESS,
    random_get: (ptr: Num, len: Num) => {
      const tmp = new Uint8Array(u32(len));
      for (let i = 0; i < tmp.length; i += 65536) crypto.getRandomValues(tmp.subarray(i, i + 65536));
      this.bytes(u32(ptr), tmp.length).set(tmp);
      return E.SUCCESS;
    },
    sock_accept: () => E.NOTSUP,
    sock_recv: () => E.NOTSUP,
    sock_send: () => E.NOTSUP,
    sock_shutdown: () => E.NOTSUP,
  };

  private nextFd() {
    let fd = 3;
    while (this.fds[fd]) fd++;
    return fd;
  }

  private writeStrings(list: Uint8Array[], ptrs: number, buf: number) {
    const dv = this.dv();
    for (const s of list) {
      dv.setUint32(ptrs, buf, true);
      this.bytes(buf, s.length).set(s);
      ptrs += 4;
      buf += s.length;
    }
    return E.SUCCESS;
  }

  private readv(fd: number, iovs: Num, iovsLen: Num, nread: Num, at: number | null) {
    const f = this.fds[fd];
    if (!f) return E.BADF;
    let total = 0;
    if (f.kind === "stdin") {
      for (const [p, l] of this.iovs(iovs, iovsLen)) {
        const n = Math.min(l, this.stdin.length - this.stdinPos);
        this.bytes(p, n).set(this.stdin.subarray(this.stdinPos, this.stdinPos + n));
        this.stdinPos += n;
        total += n;
        if (n < l) break;
      }
    } else if (f.kind === "file") {
      const data = contents(f.node);
      let pos = at ?? f.pos;
      for (const [p, l] of this.iovs(iovs, iovsLen)) {
        const n = Math.max(0, Math.min(l, data.length - pos));
        if (n) this.bytes(p, n).set(data.subarray(pos, pos + n));
        pos += n;
        total += n;
        if (n < l) break;
      }
      if (at === null) f.pos = pos;
    } else return f.kind === "dir" ? E.ISDIR : E.BADF;
    this.dv().setUint32(u32(nread), total, true);
    return E.SUCCESS;
  }

  private writev(fd: number, iovs: Num, iovsLen: Num, nwritten: Num, at: number | null) {
    const f = this.fds[fd];
    if (!f) return E.BADF;
    const list = this.iovs(iovs, iovsLen);
    let total = 0;
    if (f.kind === "stdout" || f.kind === "stderr") {
      for (const [, l] of list) total += l;
      const out = new Uint8Array(total);
      let o = 0;
      for (const [p, l] of list) out.set(this.bytes(p, l), o), (o += l);
      if (total) this.opts.onOutput(f.kind === "stdout" ? 1 : 2, out);
    } else if (f.kind === "file") {
      let pos = at ?? (f.append ? f.node.size : f.pos);
      for (const [p, l] of list) {
        writeAt(f.node, pos, this.bytes(p, l));
        pos += l;
        total += l;
      }
      if (at === null) f.pos = pos;
    } else return f.kind === "dir" ? E.ISDIR : E.BADF;
    this.dv().setUint32(u32(nwritten), total, true);
    return E.SUCCESS;
  }
}

/** Instantiate and run a single-threaded WASI command module. */
export async function runCommand(module: WebAssembly.Module, opts: WasiOptions): Promise<number> {
  const wasi = new Wasi(opts);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.imports(module) });
  return wasi.start(instance);
}
