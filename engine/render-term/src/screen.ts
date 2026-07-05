// The terminal cell surface + ANSI codec — the CellPainter's target. A grid of
// styled cells; diff against the previous frame and emit ANSI only for changed
// cells (no full repaint → no flicker). Ported from probevane's proven src/tui
// render runtime; `CellStyle.fg/bg` are packed 0xRRGGBB (the shared colour model).

export interface CellStyle {
  fg?: number; // packed 24-bit 0xRRGGBB
  bg?: number;
  bold?: boolean;
}
export interface Cell { ch: string; st: CellStyle }
export interface Screen { w: number; h: number; cells: Cell[] } // cells row-major, length w*h

const SPACE: Cell = { ch: ' ', st: {} };

export function blank(w: number, h: number): Screen {
  return { w, h, cells: Array.from({ length: w * h }, () => ({ ...SPACE })) };
}

/** Write a string at (x,y), clipped. When `st` has no bg, the cell's existing bg is preserved
 *  (so text over a fillRect'd panel keeps the panel colour). */
export function putText(scr: Screen, x: number, y: number, text: string, st: CellStyle = {}): void {
  if (y < 0 || y >= scr.h) return;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const cx = x + i;
    if (cx < 0 || cx >= scr.w) continue;
    const idx = y * scr.w + cx;
    const bg = st.bg ?? scr.cells[idx]!.st.bg;
    scr.cells[idx] = { ch: chars[i]!, st: bg === undefined ? st : { ...st, bg } };
  }
}

/** Fill a rect with a background colour (blank cells) — the panel/screen fill under the content. */
export function fillRect(scr: Screen, x: number, y: number, w: number, h: number, bg: number): void {
  for (let r = 0; r < h; r++) {
    const cy = y + r;
    if (cy < 0 || cy >= scr.h) continue;
    for (let c = 0; c < w; c++) {
      const cx = x + c;
      if (cx < 0 || cx >= scr.w) continue;
      scr.cells[cy * scr.w + cx] = { ch: ' ', st: { bg } };
    }
  }
}

/** Copy the non-blank cells of `src` into `dst` at offset (dx,dy) — overlay a widget
 *  rendered on its own surface into a larger frame (blank cells don't clobber it). */
export function blit(dst: Screen, src: Screen, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const c = src.cells[y * src.w + x]!;
      if (c.ch === ' ' && c.st.bg === undefined && c.st.fg === undefined) continue;
      const X = dx + x, Y = dy + y;
      if (X < 0 || X >= dst.w || Y < 0 || Y >= dst.h) continue;
      dst.cells[Y * dst.w + X] = { ch: c.ch, st: c.st };
    }
  }
}

/** Draw a titled box (rounded box-drawing) filling the given rect. */
export function box(scr: Screen, x: number, y: number, w: number, h: number, title: string, st: CellStyle = {}): void {
  if (w < 2 || h < 2) return;
  putText(scr, x, y, '╭' + '─'.repeat(w - 2) + '╮', st);
  putText(scr, x, y + h - 1, '╰' + '─'.repeat(w - 2) + '╯', st);
  for (let r = 1; r < h - 1; r++) {
    putText(scr, x, y + r, '│', st);
    putText(scr, x + w - 1, y + r, '│', st);
  }
  if (title) putText(scr, x + 2, y, ' ' + title + ' ', { ...st, bold: true });
}

// 24-bit truecolor when the terminal advertises it; else nearest 256-color cube.
const truecolor = (): boolean => /truecolor|24bit/i.test(process.env.COLORTERM ?? '');
const rgb = (n: number): [number, number, number] => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const to256 = (n: number): number => {
  const [r, g, b] = rgb(n).map((c) => Math.round((c / 255) * 5)) as [number, number, number];
  return 16 + 36 * r + 6 * g + b;
};
function colorCodes(n: number, base: 38 | 48): string {
  return truecolor() ? `${base};2;${rgb(n).join(';')}` : `${base};5;${to256(n)}`;
}

function sgr(st: CellStyle): string {
  const parts: string[] = [];
  if (st.bold) parts.push('1');
  if (st.fg !== undefined) parts.push(colorCodes(st.fg, 38));
  if (st.bg !== undefined) parts.push(colorCodes(st.bg, 48));
  return parts.length ? `\x1b[${parts.join(';')}m` : '';
}
export const styleSgr = sgr;
const sameStyle = (a: CellStyle, b: CellStyle): boolean => a.fg === b.fg && a.bg === b.bg && !!a.bold === !!b.bold;

/** Full-screen ANSI (home + every row) — first frame + after resize. */
export function serialize(scr: Screen): string {
  let out = '\x1b[H';
  for (let y = 0; y < scr.h; y++) {
    out += `\x1b[${y + 1};1H`;
    let cur: CellStyle = {};
    for (let x = 0; x < scr.w; x++) {
      const c = scr.cells[y * scr.w + x]!;
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
  let cur: CellStyle | null = null;
  let cursorAt = -1;
  for (let i = 0; i < next.cells.length; i++) {
    const a = prev.cells[i]!;
    const b = next.cells[i]!;
    if (a.ch === b.ch && sameStyle(a.st, b.st)) continue;
    if (i !== cursorAt) { out += `\x1b[${Math.floor(i / next.w) + 1};${(i % next.w) + 1}H`; cur = null; }
    if (!cur || !sameStyle(cur, b.st)) { out += '\x1b[0m' + sgr(b.st); cur = b.st; }
    out += b.ch;
    cursorAt = i + 1;
  }
  return out ? out + '\x1b[0m' : '';
}
