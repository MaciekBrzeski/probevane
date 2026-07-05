// Braille subpixel raster — 2×4 dots per cell (U+2800 block) give curves and
// diagonals a smooth look in the terminal. Plots in WORLD units (1 cell = 1
// unit); internally samples at ×2 horizontal, ×4 vertical (≈ square on a typical
// 1:2 character cell). Accumulate dots, then flush braille glyphs into a Screen.

import type { Screen } from './screen';

// Dot bit per (row 0..3, col 0..1) within a cell.
const DOTS: number[][] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export class Braille {
  private bits: Uint8Array;
  private col: Int32Array;
  constructor(private w: number, private h: number) {
    this.bits = new Uint8Array(w * h);
    this.col = new Int32Array(w * h).fill(-1);
  }

  private plot(sx: number, sy: number, color: number): void {
    const cx = Math.floor(sx / 2), cy = Math.floor(sy / 4);
    if (cx < 0 || cx >= this.w || cy < 0 || cy >= this.h) return;
    const i = cy * this.w + cx;
    this.bits[i]! |= DOTS[((sy % 4) + 4) % 4]![((sx % 2) + 2) % 2]!;
    this.col[i] = color;
  }

  dot(wx: number, wy: number, color: number): void {
    this.plot(Math.round(wx * 2), Math.round(wy * 4), color);
  }

  /** Bresenham line in subpixel space (world endpoints). */
  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    let x = Math.round(x0 * 2), y = Math.round(y0 * 4);
    const bx = Math.round(x1 * 2), by = Math.round(y1 * 4);
    const dx = Math.abs(bx - x), dy = Math.abs(by - y), sx = x < bx ? 1 : -1, sy = y < by ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.plot(x, y, color);
      if (x === bx && y === by) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  /** Arc centred at (cx,cy) radius r from a0→a1 (radians). `yScale` squashes the
   *  vertical radius so a circle looks round on a ~1:2 character cell (else a
   *  same-radius arc renders as a tall egg). */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, color: number, yScale = 1): void {
    const steps = Math.max(6, Math.ceil(Math.abs(a1 - a0) * r * 4));
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      this.dot(cx + r * Math.cos(a), cy + r * yScale * Math.sin(a), color);
    }
  }

  /** Merge accumulated braille glyphs into `scr` via `put(scr,x,y,ch,color)`. */
  flush(scr: Screen, put: (scr: Screen, x: number, y: number, ch: string, color: number) => void): void {
    for (let i = 0; i < this.bits.length; i++) {
      const b = this.bits[i]!;
      if (!b) continue;
      put(scr, i % this.w, Math.floor(i / this.w), String.fromCodePoint(0x2800 + b), this.col[i]!);
    }
  }
}
