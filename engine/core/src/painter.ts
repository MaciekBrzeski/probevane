// The abstract 2D drawing surface. A widget is authored ONCE against Painter in
// float world coordinates; a backend (SvgPainter / CellPainter) implements it.
// Widgets branch on `caps` only where a medium genuinely can't follow (ring→bar).

import type { Style } from './style';

export interface Pt { x: number; y: number }

/** What a backend can do. */
export interface Caps {
  /** Sub-cell / anti-aliased plotting (braille 2×4 in the terminal; native on a canvas). */
  subpixel: boolean;
  /** Smooth arcs / béziers (approximated by braille in the terminal). */
  curves: boolean;
  /** The output is a character grid (terminal), so 1 world unit ≈ 1 glyph and small
   *  boxes can't hold text — widgets draw 1-row text pills instead of rects. False on a
   *  pixel canvas (SVG). The one place a widget legitimately branches on the medium. */
  glyphGrid: boolean;
  /** World units per output cell (1 for a true pixel canvas; a text cell in the terminal). */
  cellW: number;
  cellH: number;
}

/** Immediate-mode vector drawing in float world coordinates; origin top-left, +y down. */
export interface Painter {
  readonly caps: Caps;
  rect(x: number, y: number, w: number, h: number, st: Style): void;
  line(x0: number, y0: number, x1: number, y1: number, st: Style): void;
  polyline(pts: Pt[], st: Style): void;
  /** A closed filled shape (e.g. a sparkline area). Cells draw the outline only. */
  polygon(pts: Pt[], st: Style): void;
  /** Arc centred at (cx,cy), radius r, from angle a0 to a1 (radians, 0 = +x, clockwise). */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, st: Style): void;
  text(x: number, y: number, str: string, st: Style): void;
  /** Push a translation onto the transform stack (nestable); `pop` restores. */
  push(dx: number, dy: number): void;
  pop(): void;
}
