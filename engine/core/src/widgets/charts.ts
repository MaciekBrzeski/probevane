// Chart widgets — barChart, donut, heatmap, legend, meter. Authored once against
// Painter: block/rect fills in cells, rects/arcs in SVG. Arcs are aspect-
// corrected by the cell backend so the donut reads round in the terminal too.

import type { Painter } from '../painter';
import type { Rect } from '../geom';
import { clamp } from '../geom';
import { mix } from '../style';

export interface BarChartModel { rect: Rect; values: number[]; accent: number; track?: number }
/** Categorical vertical bars, scaled to the series max (optional track behind). */
export function barChart(p: Painter, m: BarChartModel): void {
  const { x, y, w, h } = m.rect;
  const max = Math.max(1, ...m.values);
  const bw = Math.max(1, Math.floor(w / Math.max(1, m.values.length)));
  m.values.forEach((v, i) => {
    const bx = x + i * bw;
    if (m.track !== undefined) p.rect(bx, y, Math.max(1, bw - 1), h, { fill: m.track });
    const bh = Math.round((clamp(v, 0, max) / max) * h);
    if (bh > 0) p.rect(bx, y + h - bh, Math.max(1, bw - 1), bh, { fill: m.accent });
  });
}

const TOP = -Math.PI / 2;
export interface DonutSegment { value: number; color: number }
export interface DonutModel { cx: number; cy: number; r: number; segments: DonutSegment[]; track?: number; label?: string; labelColor?: number }
/** A proportion ring — one accent arc per segment (share of the total), 12 o'clock start. */
export function donut(p: Painter, m: DonutModel): void {
  const total = m.segments.reduce((s, x) => s + x.value, 0) || 1;
  if (m.track !== undefined) p.arc(m.cx, m.cy, m.r, TOP, TOP + 2 * Math.PI, { stroke: m.track, width: 1 });
  let a = TOP;
  for (const seg of m.segments) {
    const a1 = a + 2 * Math.PI * (seg.value / total);
    if (seg.value > 0) p.arc(m.cx, m.cy, m.r, a, a1, { stroke: seg.color, width: 2 });
    a = a1;
  }
  if (m.label) p.text(m.cx, m.cy, m.label, { fill: m.labelColor ?? m.segments[0]?.color ?? 0xffffff, align: 'c', bold: true });
}

export interface HeatmapModel { x: number; y: number; cols: number; rows: number; values: number[]; base: number; color: number; cell?: number }
/** A grid of intensity-shaded cells (values 0..1, row-major) — coverage/calendar/matrix. */
export function heatmap(p: Painter, m: HeatmapModel): void {
  const cw = m.cell ?? 2;
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const v = clamp(m.values[r * m.cols + c] ?? 0, 0, 1);
      p.rect(m.x + c * cw, m.y + r, cw, 1, { fill: mix(m.base, m.color, v) });
    }
  }
}

export interface LegendItem { label: string; color: number }
export interface LegendModel { x: number; y: number; items: LegendItem[]; fg?: number; horizontal?: boolean }
/** Colour swatch + label rows (or a single row) — the chart companion. */
export function legend(p: Painter, m: LegendModel): void {
  let cx = m.x, cy = m.y;
  for (const it of m.items) {
    p.rect(cx, cy, 1, 1, { fill: it.color });
    p.text(cx + 2, cy, it.label, { fill: m.fg ?? it.color });
    if (m.horizontal) cx += 2 + [...it.label].length + 2; else cy += 1;
  }
}

export interface MeterSegment { value: number; color: number }
export interface MeterModel { rect: Rect; segments: MeterSegment[]; track?: number }
/** A stacked horizontal bar — segments sized to their share of the total (storage-bar style). */
export function meter(p: Painter, m: MeterModel): void {
  const { x, y, w, h } = m.rect;
  const total = m.segments.reduce((s, x2) => s + x2.value, 0) || 1;
  if (m.track !== undefined) p.rect(x, y, w, h, { fill: m.track });
  let cx = x;
  for (const seg of m.segments) {
    const sw = w * (seg.value / total);
    if (sw > 0) p.rect(cx, y, sw, h, { fill: seg.color });
    cx += sw;
  }
}
