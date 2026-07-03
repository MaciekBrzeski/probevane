// Tiny terminal render runtime — the browser h()/DOM analog for the TUI. Build
// a grid of styled cells, diff against the previous frame, emit ANSI for only
// the changed cells (no full-screen repaint → no flicker). Panes are pure
// functions painting into a Screen; src/cli/tui-app.ts owns the flush + tty.
// Pure + unit-testable (serialize a Screen to a string, assert substrings).

export interface Style {
  fg?: number; // SGR 30-37 / 90-97
  bg?: number;
  bold?: boolean;
}
export interface Cell {
  ch: string;
  st: Style;
}
export interface Screen {
  w: number;
  h: number;
  cells: Cell[]; // row-major, length w*h
}

const SPACE: Cell = { ch: ' ', st: {} };

export function blank(w: number, h: number): Screen {
  return { w, h, cells: Array.from({ length: w * h }, () => ({ ...SPACE })) };
}

/** Write a string at (x,y), clipped to the screen; combining/wide chars unhandled (mono ASCII/box). */
export function putText(scr: Screen, x: number, y: number, text: string, st: Style = {}): void {
  if (y < 0 || y >= scr.h) return;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const cx = x + i;
    if (cx < 0 || cx >= scr.w) continue;
    scr.cells[y * scr.w + cx] = { ch: chars[i], st };
  }
}

/** Draw a titled box (single-line box-drawing) filling the given rect. */
export function box(scr: Screen, x: number, y: number, w: number, h: number, title: string, st: Style = {}): void {
  if (w < 2 || h < 2) return;
  const top = '┌' + '─'.repeat(w - 2) + '┐';
  const bot = '└' + '─'.repeat(w - 2) + '┘';
  putText(scr, x, y, top, st);
  putText(scr, x, y + h - 1, bot, st);
  for (let r = 1; r < h - 1; r++) {
    putText(scr, x, y + r, '│', st);
    putText(scr, x + w - 1, y + r, '│', st);
  }
  if (title) putText(scr, x + 2, y, ' ' + title + ' ', { ...st, bold: true });
}

/** SGR prefix for a style (empty when default). */
function sgr(st: Style): string {
  const codes: number[] = [];
  if (st.bold) codes.push(1);
  if (st.fg !== undefined) codes.push(st.fg);
  if (st.bg !== undefined) codes.push(st.bg + 10);
  return codes.length ? `\x1b[${codes.join(';')}m` : '';
}
const sameStyle = (a: Style, b: Style) => a.fg === b.fg && a.bg === b.bg && !!a.bold === !!b.bold;

/** Full-screen ANSI (home + every row) — used for the first frame + after resize. */
export function serialize(scr: Screen): string {
  let out = '\x1b[H';
  for (let y = 0; y < scr.h; y++) {
    out += `\x1b[${y + 1};1H`;
    let cur: Style = {};
    for (let x = 0; x < scr.w; x++) {
      const c = scr.cells[y * scr.w + x];
      if (!sameStyle(c.st, cur)) { out += '\x1b[0m' + sgr(c.st); cur = c.st; }
      out += c.ch;
    }
    out += '\x1b[0m';
  }
  return out;
}

/** Minimal ANSI to turn `prev` into `next` — cursor-address only the changed cells. */
export function diff(prev: Screen | null, next: Screen): string {
  if (!prev || prev.w !== next.w || prev.h !== next.h) return serialize(next);
  let out = '';
  let cur: Style | null = null;
  let cursorAt = -1; // linear index the terminal cursor is at, or -1
  for (let i = 0; i < next.cells.length; i++) {
    const a = prev.cells[i];
    const b = next.cells[i];
    if (a.ch === b.ch && sameStyle(a.st, b.st)) continue;
    if (i !== cursorAt) { out += `\x1b[${Math.floor(i / next.w) + 1};${(i % next.w) + 1}H`; cur = null; }
    if (!cur || !sameStyle(cur, b.st)) { out += '\x1b[0m' + sgr(b.st); cur = b.st; }
    out += b.ch;
    cursorAt = i + 1;
  }
  return out ? out + '\x1b[0m' : '';
}
