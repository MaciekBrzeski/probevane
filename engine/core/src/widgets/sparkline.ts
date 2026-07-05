// Sparkline — a polyline of values scaled into a rect (newest at right), with an
// optional gradient area fill. One definition: SVG polyline (+ gradient <polygon>),
// cell braille polyline (the area is an SVG-only nicety → no-op in cells).

import type { Painter } from '../painter';
import type { Style } from '../style';
import type { Rect } from '../geom';

export interface SparkModel {
  rect: Rect; points: number[]; accent: number;
  area?: boolean; // gradient area under the line (SVG only)
  strokeWidth?: number;
  tag?: string; pathLength?: number; // SVG hooks (e.g. a self-drawing stroke)
}

export function sparkline(p: Painter, m: SparkModel): void {
  const pts = m.points;
  if (pts.length < 2) return;
  const { x, y, w, h } = m.rect;
  const max = Math.max(1, ...pts);
  const at = (i: number): { x: number; y: number } => ({ x: x + (i / (pts.length - 1)) * w, y: y + h - (pts[i]! / max) * h });
  const line = pts.map((_, i) => at(i));
  if (m.area) p.polygon([{ x, y: y + h }, ...line, { x: x + w, y: y + h }], { fill: m.accent, gradient: true });
  const st: Style = { stroke: m.accent, width: m.strokeWidth ?? 1 };
  if (m.tag) st.tag = m.tag;
  if (m.pathLength !== undefined) st.pathLength = m.pathLength;
  p.polyline(line, st);
}
