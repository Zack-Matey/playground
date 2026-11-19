import { describe, expect, it } from "vitest";
import { dir, lookup, mountTar, put, read } from "app/run/wasi/fs";
import { Wasi } from "app/run/wasi/wasi";

/** A minimal ustar archive with one file and one directory. */
function tar(entries: { name: string; data?: string; dir?: boolean }[]) {
  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const e of entries) {
    const h = new Uint8Array(512);
    h.set(enc.encode(e.name), 0);
    const body = enc.encode(e.data ?? "");
    h.set(enc.encode(body.length.toString(8).padStart(11, "0")), 124);
    h[156] = e.dir ? 53 : 48;
    h.set(enc.encode("ustar"), 257);
    blocks.push(h);
    if (body.length) {
      const b = new Uint8Array(Math.ceil(body.length / 512) * 512);
      b.set(body);
      blocks.push(b);
    }
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of blocks) out.set(b, o), (o += b.length);
  return out;
}

describe("in-memory fs", () => {
  it("mounts a tar archive", () => {
    const root = dir();
    mountTar(root, "sysroot/lib", tar([{ name: "a/", dir: true }, { name: "a/libc.a", data: "!<arch>\n" }]));
    expect(new TextDecoder().decode(read(root, "/sysroot/lib/a/libc.a"))).toBe("!<arch>\n");
    expect(lookup(root, "sysroot/lib/a")?.kind).toBe("dir");
  });
});

describe("wasi", () => {
  // Drive the syscalls directly against a plain memory, as a guest would.
  const setup = () => {
    const root = dir();
    put(root, "/work/in.txt", "hello");
    const out: string[] = [];
    const w = new Wasi({ args: ["prog", "x"], root, onOutput: (fd, b) => out.push(`${fd}:${new TextDecoder().decode(b)}`), stdin: new TextEncoder().encode("abc") });
    w.memory = new WebAssembly.Memory({ initial: 1 });
    const mem = () => new DataView(w.memory!.buffer);
    const bytes = () => new Uint8Array(w.memory!.buffer);
    const str = (p: number, s: string) => (bytes().set(new TextEncoder().encode(s), p), s.length);
    return { w, root, out, mem, bytes, str };
  };

  it("opens, reads, writes and creates files", () => {
    const { w, root, mem, bytes, str } = setup();
    const f = w.fns;
    const len = str(100, "work/in.txt");
    expect(f.path_open(3, 0, 100, len, 0, 0n, 0n, 0, 200)).toBe(0);
    const fd = mem().getUint32(200, true);
    mem().setUint32(300, 400, true); // iovec: buf=400, len=16
    mem().setUint32(304, 16, true);
    expect(f.fd_read(fd, 300, 1, 308)).toBe(0);
    expect(mem().getUint32(308, true)).toBe(5);
    expect(new TextDecoder().decode(bytes().slice(400, 405))).toBe("hello");

    const l2 = str(100, "work/out.txt");
    expect(f.path_open(3, 0, 100, l2, 1 /* CREAT */, 0n, 0n, 0, 200)).toBe(0);
    const out = mem().getUint32(200, true);
    mem().setUint32(304, 5, true);
    expect(f.fd_write(out, 300, 1, 308)).toBe(0);
    expect(new TextDecoder().decode(read(root, "/work/out.txt"))).toBe("hello");
    expect(f.path_open(3, 0, 100, str(100, "work/missing"), 0, 0n, 0n, 0, 200)).toBe(44); // ENOENT
  });

  it("reads stdin, writes stdout, and reports args", () => {
    const { w, out, mem, str } = setup();
    mem().setUint32(300, 400, true);
    mem().setUint32(304, 2, true);
    expect(w.fns.fd_read(0, 300, 1, 308)).toBe(0);
    expect(mem().getUint32(308, true)).toBe(2);
    str(400, "hi\n");
    mem().setUint32(304, 3, true);
    w.fns.fd_write(1, 300, 1, 308);
    expect(out).toEqual(["1:hi\n"]);
    w.fns.args_sizes_get(500, 504);
    expect(mem().getUint32(500, true)).toBe(2);
    expect(mem().getUint32(504, true)).toBe("prog\0x\0".length);
  });

  it("proc_exit throws Exit with the code", () => {
    const { w } = setup();
    expect(() => w.fns.proc_exit(3)).toThrow(expect.objectContaining({ code: 3 }));
  });
});
