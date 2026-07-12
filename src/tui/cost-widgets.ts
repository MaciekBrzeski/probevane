// Cost-tab extras — a daily-cost barChart in the pane's upper half and an
// acceptance donut + legend in the lower half, drawn via the facet bridge into
// the cost pane's spare rows (around costPane's sparkline + date). Guards on
// height so it no-ops in a short pane and never clobbers the tested rows.

import { type Screen } from './screen.js';
import { paintWidget } from './facet.js';
import { FG } from './draw.js';
import { barChart, donut, legend, type Painter } from '@facet/core';
import type { Rect, Snapshot } from './views.js';

/** Daily-cost bars + acceptance donut/legend in the cost pane's empty space. */
export function costExtras(scr: Screen, r: Rect, s: Snapshot): void {
  paintWidget(scr, r, (p) => {
    const midY = Math.floor(r.h / 2);
    if (midY > 5 && s.daily.length) upperBars(p, r.w, midY, s);
    const dy = midY + 2;
    if (r.h - dy > 13) acceptDonut(p, dy, s.totals.acceptRate ?? 0);
  });
}

/** Daily-cost bars in the pane's upper half — per-day magnitude the sparkline alone can't show. */
function upperBars(p: Painter, w: number, midY: number, s: Snapshot): void {
  p.text(2, 1, 'daily $', { fill: FG.dim });
  const rect = { x: 2, y: 2, w: w - 4, h: midY - 4 };
  barChart(p, { rect, values: s.daily.map((d) => d.cost), accent: FG.acc, track: FG.line });
}

/** Acceptance donut + legend in the lower half — accept vs reject share at a glance. */
function acceptDonut(p: Painter, dy: number, acc: number): void {
  donut(p, {
    cx: 10, cy: dy + 6, r: 6, track: FG.line, label: `${Math.round(acc * 100)}%`, labelColor: FG.ok,
    segments: [{ value: acc, color: FG.ok }, { value: Math.max(0, 1 - acc), color: FG.err }],
  });
  legend(p, { x: 22, y: dy + 4, fg: FG.fg, items: [{ label: 'accepted', color: FG.ok }, { label: 'rejected', color: FG.err }] });
}
