/**
 * Runs inside QuickJS before the user's code: console (with Node-style object formatting), timers on a real event
 * loop, readline()/prompt() over stdin, and performance.now(). Host functions arrive as __host and are hidden after.
 */
export const PRELUDE = String.raw`
(() => {
  const host = globalThis.__host;
  delete globalThis.__host;

  // ---------- inspect: Node-like formatting ----------
  const isIdent = (k) => /^[A-Za-z_$][\w$]*$/.test(k);
  const quote = (s) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
  function inspect(v, depth, seen, top) {
    switch (typeof v) {
      case "string": return top ? v : quote(v);
      case "number": return Object.is(v, -0) ? "-0" : String(v);
      case "bigint": return v + "n";
      case "undefined": return "undefined";
      case "boolean": return String(v);
      case "symbol": return v.toString();
      case "function": {
        const src = Function.prototype.toString.call(v);
        if (/^class\b/.test(src)) return "[class " + (v.name || "(anonymous)") + "]";
        return "[Function: " + (v.name || "(anonymous)") + "]";
      }
    }
    if (v === null) return "null";
    if (seen.includes(v)) return "[Circular]";
    if (v instanceof Error) return v.stack ? v.name + ": " + v.message + "\n" + v.stack.replace(/\n$/, "") : String(v);
    if (v instanceof Date) return isNaN(v) ? "Invalid Date" : v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (v instanceof Promise) return "Promise { <pending> }";
    if (depth > 2) return Array.isArray(v) ? "[Array]" : "[Object]";
    const next = [...seen, v];
    const items = [];
    let open = "{", close = "}", prefix = "";
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      open = "["; close = "]";
      if (!Array.isArray(v)) prefix = v.constructor.name + "(" + v.length + ") ";
      const n = Math.min(v.length, 100);
      for (let i = 0; i < n; i++) items.push(i in v ? inspect(v[i], depth + 1, next) : "<empty>");
      if (v.length > n) items.push("... " + (v.length - n) + " more items");
    } else if (v instanceof Map) {
      prefix = "Map(" + v.size + ") ";
      for (const [k, x] of v) items.push(inspect(k, depth + 1, next) + " => " + inspect(x, depth + 1, next));
    } else if (v instanceof Set) {
      prefix = "Set(" + v.size + ") ";
      for (const x of v) items.push(inspect(x, depth + 1, next));
    } else {
      const proto = Object.getPrototypeOf(v);
      const name = proto === null ? "[Object: null prototype]" : proto.constructor && proto.constructor !== Object ? proto.constructor.name : "";
      if (name) prefix = name + " ";
    }
    if (!(v instanceof Map) && !(v instanceof Set))
      for (const k of Object.keys(v)) {
        if (Array.isArray(v) && /^\d+$/.test(k)) continue;
        items.push((isIdent(k) ? k : quote(k)) + ": " + inspect(v[k], depth + 1, next));
      }
    if (!items.length) return prefix + open + close;
    const flat = prefix + open + " " + items.join(", ") + " " + close;
    if (flat.length <= 72 && !flat.includes("\n")) return flat;
    const pad = "  ".repeat(depth + 1);
    return prefix + open + "\n" + items.map((s) => pad + s.replace(/\n/g, "\n" + pad)).join(",\n") + "\n" + "  ".repeat(depth) + close;
  }

  function format(args) {
    if (!args.length) return "";
    let out = "";
    let i = 0;
    if (typeof args[0] === "string" && /%[sdifjoOc%]/.test(args[0])) {
      i = 1;
      out = args[0].replace(/%([sdifjoOc%])/g, (m, c) => {
        if (c === "%") return "%";
        if (i >= args.length) return m;
        const a = args[i++];
        switch (c) {
          case "s": return typeof a === "string" ? a : inspect(a, 1, [], false);
          case "d": case "i": return typeof a === "bigint" ? a + "n" : String(c === "i" ? parseInt(a) : Number(a));
          case "f": return String(parseFloat(a));
          case "j": try { return JSON.stringify(a); } catch { return "[Circular]"; }
          case "c": return "";
          default: return inspect(a, 0, [], false);
        }
      });
    } else out = inspect(args[i++], 0, [], true);
    for (; i < args.length; i++) out += " " + inspect(args[i], 0, [], true);
    return out;
  }

  let indent = "";
  const line = (fd) => (...args) => host.write(fd, format(args).replace(/^/gm, indent) + "\n");
  const counts = new Map(), timers = new Map();
  globalThis.console = {
    log: line(1), info: line(1), debug: line(1), dir: line(1), trace: line(2), warn: line(2), error: line(2),
    assert: (ok, ...a) => { if (!ok) line(2)("Assertion failed" + (a.length ? ": " + format(a) : "")); },
    count: (l = "default") => { counts.set(l, (counts.get(l) || 0) + 1); line(1)(l + ": " + counts.get(l)); },
    countReset: (l = "default") => counts.delete(l),
    time: (l = "default") => timers.set(l, host.now()),
    timeLog: (l = "default", ...a) => line(1)(l + ": " + (host.now() - timers.get(l)).toFixed(3) + "ms", ...a),
    timeEnd: (l = "default") => { line(1)(l + ": " + (host.now() - timers.get(l)).toFixed(3) + "ms"); timers.delete(l); },
    group: (...a) => { if (a.length) line(1)(...a); indent += "  "; },
    groupEnd: () => { indent = indent.slice(2); },
    table: (data) => {
      if (typeof data !== "object" || data === null) return line(1)(data);
      const rows = Object.keys(data);
      const cols = [...new Set(rows.flatMap((r) => (typeof data[r] === "object" && data[r] !== null ? Object.keys(data[r]) : ["Values"])))];
      const cell = (r, c) => { const x = data[r]; return typeof x === "object" && x !== null ? (c in x ? inspect(x[c], 1, [], false) : "") : c === "Values" ? inspect(x, 1, [], false) : ""; };
      const table = [["(index)", ...cols], ...rows.map((r) => [r, ...cols.map((c) => cell(r, c))])];
      const w = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
      const fmtRow = (row) => "│ " + row.map((s, i) => s.padEnd(w[i])).join(" │ ") + " │";
      const bar = (l, m, r) => l + w.map((n) => "─".repeat(n + 2)).join(m) + r;
      host.write(1, [bar("┌", "┬", "┐"), fmtRow(table[0]), bar("├", "┼", "┤"), ...table.slice(1).map(fmtRow), bar("└", "┴", "┘")].join("\n") + "\n");
    },
  };
  console.groupCollapsed = console.group;

  // ---------- timers: a real event loop driven by the host (see js.ts) ----------
  let seq = 0;
  const queue = new Map();
  const add = (fn, ms, args, repeat) => {
    if (typeof fn !== "function") throw new TypeError("callback must be a function");
    const id = ++seq;
    const delay = Math.max(0, Number(ms) || 0);
    queue.set(id, { fn, args, at: host.now() + delay, delay, repeat, order: id });
    return id;
  };
  globalThis.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  globalThis.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  globalThis.setImmediate = (fn, ...args) => add(fn, 0, args, false);
  globalThis.clearTimeout = globalThis.clearInterval = globalThis.clearImmediate = (id) => queue.delete(id);
  if (typeof queueMicrotask !== "function") globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
  const due = () => {
    let best = null;
    for (const [id, t] of queue) if (!best || t.at < best[1].at || (t.at === best[1].at && t.order < best[1].order)) best = [id, t];
    return best;
  };
  globalThis.__loop = {
    // Milliseconds until the next timer is due, or -1 when nothing is scheduled.
    next() { const d = due(); return d ? Math.max(0, d[1].at - host.now()) : -1; },
    fire() {
      const d = due();
      if (!d) return;
      const [id, t] = d;
      if (t.repeat) { t.at = host.now() + Math.max(1, t.delay); t.order = ++seq; } else queue.delete(id);
      t.fn(...t.args);
    },
    report(e) { line(2)("Uncaught " + inspect(e, 0, [], true)); },
  };

  // ---------- stdin ----------
  globalThis.readline = () => host.readline();
  globalThis.prompt = (msg) => { if (msg !== undefined) host.write(1, String(msg)); return host.readline(); };

  const t0 = host.now();
  globalThis.performance = { now: () => host.now() - t0, timeOrigin: Date.now() };
})();
`;
