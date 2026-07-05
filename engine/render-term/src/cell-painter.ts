// CellPainter — the terminal backend. Implements the abstract Painter by
// rasterizing vectors into a cell Screen: axis-aligned rect/line → box-drawing,
// curves/diagonals → braille subpixels, text → putText. `flush()` merges the
// braille layer and returns the Screen; `toAnsi(prev)` diff-flushes to ANSI.

import type { Painter, Caps, Pt, Style } from '@facet/core';
import { blank, putText, fillRect, box, diff, type Screen, type CellStyle } from './screen';
import { Braille } from './braille';

export class CellPainter implements Painter {
  readonly caps: Caps = { subpixel: true, curves: true, glyphGrid: true, cellW: 1, cellH: 1 };
  // A terminal cell is ~twice as tall as wide; squash arc y-radius to match so
  // circles render round rather than as a vertical egg.
  private static readonly CELL_ASPECT = 0.5;
  readonly screen: Screen;
  private braille: Braille;
  private stack: Pt[] = [];

  constructor(public readonly w: number, public readonly h: number) {
    this.screen = blank(w, h);
    this.braille = new Braille(w, h);
  }

  private ox(): number { return this.stack.reduce((s, p) => s + p.x, 0); }
  private oy(): number { return this.stack.reduce((s, p) => s + p.y, 0); }
  private strokeOf(st: Style): number { return st.stroke ?? st.fill ?? 0xffffff; }

  push(dx: number, dy: number): void { this.stack.push({ x: dx, y: dy }); }
  pop(): void { this.stack.pop(); }

  rect(x: number, y: number, w: number, h: number, st: Style): void {
    const X = Math.round(x + this.ox()), Y = Math.round(y + this.oy()), W = Math.round(w), H = Math.round(h);
    if (st.fill !== undefined) fillRect(this.screen, X, Y, W, H, st.fill);
    if (st.stroke !== undefined) box(this.screen, X, Y, W, H, '', { fg: st.stroke, ...(st.bold ? { bold: true } : {}) });
  }

  line(x0: number, y0: number, x1: number, y1: number, st: Style): void {
    const X0 = x0 + this.ox(), Y0 = y0 + this.oy(), X1 = x1 + this.ox(), Y1 = y1 + this.oy();
    const col = this.strokeOf(st);
    if (Math.round(X0) === Math.round(X1) || Math.round(Y0) === Math.round(Y1)) this.axisLine(X0, Y0, X1, Y1, col);
    else this.braille.line(X0, Y0, X1, Y1, col);
  }

  private axisLine(x0: number, y0: number, x1: number, y1: number, col: number): void {
    const st: CellStyle = { fg: col };
    if (Math.round(y0) === Math.round(y1)) {
      const y = Math.round(y0), a = Math.round(Math.min(x0, x1)), b = Math.round(Math.max(x0, x1));
      putText(this.screen, a, y, '─'.repeat(Math.max(1, b - a + 1)), st);
    } else {
      const x = Math.round(x0), a = Math.round(Math.min(y0, y1)), b = Math.round(Math.max(y0, y1));
      for (let y = a; y <= b; y++) putText(this.screen, x, y, '│', st);
    }
  }

  polyline(pts: Pt[], st: Style): void {
    for (let i = 1; i < pts.length; i++) this.line(pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y, st);
  }

  // Filled shapes are an SVG-only nicety (gradient areas); in cells the stroke
  // carries the shape, so a filled polygon draws nothing here.
  polygon(_pts: Pt[], _st: Style): void { /* no fill in cells */ }

  arc(cx: number, cy: number, r: number, a0: number, a1: number, st: Style): void {
    this.braille.arc(cx + this.ox(), cy + this.oy(), r, a0, a1, this.strokeOf(st), CellPainter.CELL_ASPECT);
  }

  text(x: number, y: number, str: string, st: Style): void {
    let X = Math.round(x + this.ox());
    const Y = Math.round(y + this.oy());
    const len = [...str].length;
    if (st.align === 'c') X -= Math.floor(len / 2);
    else if (st.align === 'r') X -= len - 1;
    const cs: CellStyle = {};
    const col = st.fill ?? st.stroke;
    if (col !== undefined) cs.fg = col;
    if (st.bold) cs.bold = true;
    putText(this.screen, X, Y, str, cs);
  }

  /** Fill the whole surface with a background colour (call before drawing). */
  clear(bg: number): void { fillRect(this.screen, 0, 0, this.w, this.h, bg); }

  /** Merge the braille layer onto the Screen and return it. Braille strokes sit
   *  BEHIND glyphs (only fill blank cells) so edges never clobber node labels/borders. */
  flush(): Screen {
    this.braille.flush(this.screen, (scr, cx, cy, ch, color) => {
      if (scr.cells[cy * scr.w + cx]!.ch === ' ') putText(scr, cx, cy, ch, { fg: color });
    });
    return this.screen;
  }

  /** Diff-flush to ANSI against the previous frame. */
  toAnsi(prev: Screen | null): string { return diff(prev, this.flush()); }
}
