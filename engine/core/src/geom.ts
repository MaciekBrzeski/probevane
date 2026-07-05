// Geometry + span math. A `Span` is a fractional sub-rect [x0,y0,x1,y1] (0..1) of
// a parent area — one layout spec that both backends consume: `spanToBox` for
// world/cell rects, `spanToCss` for the browser's absolute-positioned panes.

export interface Rect { x: number; y: number; w: number; h: number }
export type Span = [number, number, number, number]; // x0, y0, x1, y1 as fractions

/** Map a fractional span into a concrete box inside `area` (world units; caller rounds for cells). */
export function spanToBox(span: Span, area: Rect): Rect {
  const [x0, y0, x1, y1] = span;
  return { x: area.x + x0 * area.w, y: area.y + y0 * area.h, w: (x1 - x0) * area.w, h: (y1 - y0) * area.h };
}

/** The same span as an absolute-inset CSS rule for the DOM backend. */
export function spanToCss(span: Span): string {
  const [x0, y0, x1, y1] = span;
  const pc = (v: number): string => `${(v * 100).toFixed(2)}%`;
  return `left:${pc(x0)};top:${pc(y0)};width:${pc(x1 - x0)};height:${pc(y1 - y0)}`;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
