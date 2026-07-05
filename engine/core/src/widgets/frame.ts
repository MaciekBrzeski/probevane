// LCARS panel frame — a filled card, a dim border, an accent left-rail, and a
// letter-spaced uppercase title. Authored once; the cell backend renders the
// rail as an accent-bg column + rounded box-drawing, the SVG backend as rects.

import type { Painter } from '../painter';
import type { Rect } from '../geom';

export interface FrameModel { title: string; accent: number; panel: number; line: number }

const spaced = (t: string): string => [...t.toUpperCase()].join(' ');

export function frame(p: Painter, r: Rect, m: FrameModel): void {
  p.rect(r.x, r.y, r.w, r.h, { fill: m.panel, stroke: m.line });
  const rail = p.caps.glyphGrid ? 1 : Math.max(2, r.w * 0.012);
  p.rect(r.x, r.y, rail, r.h, { fill: m.accent }); // accent left-rail
  if (m.title) p.text(r.x + 3, r.y, spaced(m.title), { fill: m.accent, bold: true });
}
