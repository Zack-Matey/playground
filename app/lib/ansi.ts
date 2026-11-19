/**
 * Turn terminal output with ANSI SGR escapes (rustc, clang and Go print colored diagnostics) into styled segments.
 * Stateful across chunks, since a color can start in one write and end in another. Other escapes are dropped.
 */
export type Segment = { text: string; cls: string; fd: 1 | 2 };
export type AnsiState = { bold: boolean; dim: boolean; italic: boolean; underline: boolean; fg: number | null };

export const initialAnsi = (): AnsiState => ({ bold: false, dim: false, italic: false, underline: false, fg: null });

const classes = (s: AnsiState) =>
  [s.bold && "ansi-1", s.dim && "ansi-2", s.italic && "ansi-3", s.underline && "ansi-4", s.fg !== null && `ansi-fg-${s.fg}`].filter(Boolean).join(" ");

// CSI sequences (ESC [ … final byte) and OSC sequences (ESC ] … BEL/ST, e.g. hyperlinks).
const ESCAPES = /\x1b\[([0-9;?]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function parseAnsi(text: string, fd: 1 | 2, state: AnsiState): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const cls = classes(state);
    const prev = out[out.length - 1];
    if (prev && prev.cls === cls) prev.text += t;
    else out.push({ text: t, cls, fd });
  };
  for (const m of text.matchAll(ESCAPES)) {
    push(text.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] !== "m") continue;
    const codes = (m[1] || "0").split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) Object.assign(state, initialAnsi());
      else if (c === 1) state.bold = true;
      else if (c === 2) state.dim = true;
      else if (c === 3) state.italic = true;
      else if (c === 4) state.underline = true;
      else if (c === 22) state.bold = state.dim = false;
      else if (c === 23) state.italic = false;
      else if (c === 24) state.underline = false;
      else if (c >= 30 && c <= 37) state.fg = c - 30;
      else if (c >= 90 && c <= 97) state.fg = c - 90 + 8;
      else if (c === 39) state.fg = null;
      else if (c === 38) {
        // 38;5;n (256-color: map the first 16, ignore the rest) or 38;2;r;g;b (ignored)
        if (codes[i + 1] === 5) (state.fg = codes[i + 2] < 16 ? codes[i + 2] : null), (i += 2);
        else if (codes[i + 1] === 2) i += 4;
      }
    }
  }
  push(text.slice(last));
  return out;
}
