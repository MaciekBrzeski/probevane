// Console extras — stat / stepper / timeline drawn into the run-pipeline pane's
// empty lower half (below the rune lamps), via the facet bridge. Three columns:
// headline stats, the macro run-phase stepper, and a recent-runs timeline. Pure
// (screen + rect in), so it composes under paintConsole without disturbing the
// tested pane painters or the shared layout.

import { type Screen } from './screen.js';
import { paintWidget } from './facet.js';
import { trunc, FG } from './draw.js';
import { divider, stat, stepper, timeline, type Painter } from '@facet/core';
import type { Rect, Snapshot, Rune } from './views.js';
import type { PipelineState } from '../observe/pipeline.js';

const PHASES = ['plan', 'gate', 'learn']; // preamble → green gates → harvest

/** Macro phase (0..2) the run has reached, from how far the rune chain has gone ok/active. */
export function macroPhase(runes: Rune[], pipe: PipelineState): number {
  if (!runes.length) return 0;
  let last = -1;
  runes.forEach((rn, i) => { const st = pipe[rn.name]; if (st === 'ok' || st === 'active') last = i; });
  return Math.min(2, Math.floor(((last + 1) / runes.length) * 3));
}

/** Headline metrics as a stacked column of facet stat blocks. */
function statCol(p: Painter, x: number, w: number, t: Snapshot['totals']): void {
  divider(p, { x, y: 0, w, label: 'headline', line: FG.line, dim: FG.dim });
  const stats = [
    { label: 'acceptance', value: `${Math.round((t.acceptRate ?? 0) * 100)}%`, accent: FG.ok },
    { label: 'runs', value: String(t.runs ?? 0), accent: FG.warn },
    { label: 'total cost', value: `$${(t.totalCost ?? 0).toFixed(2)}`, accent: FG.acc },
  ];
  stats.forEach((s, i) =>
    stat(p, { x, y: 2 + i * 2, label: s.label, value: s.value, accent: s.accent, fg: FG.fg, dim: FG.dim }));
}

/** Draw the three console widgets into the pipeline pane's lower area (below the lamps). */
export function consoleWidgets(scr: Screen, r: Rect, s: Snapshot, pipe: PipelineState): void {
  const perRow = Math.max(1, Math.floor((r.w - 4) / 16));
  const lampRows = Math.max(1, Math.ceil((s.runes.length || 1) / perRow));
  const top = r.y + 1 + lampRows + 1;
  const sub = { x: r.x + 2, y: top, w: r.w - 4, h: r.y + r.h - 1 - top };
  if (sub.h < 4 || sub.w < 36) return; // too little room — leave the pane as-is
  paintWidget(scr, sub, (p) => {
    const cw = Math.floor(sub.w / 3);
    statCol(p, 0, cw - 2, s.totals);
    divider(p, { x: cw, y: 0, w: cw - 2, label: 'run phase', line: FG.line, dim: FG.dim });
    const phase = macroPhase(s.runes, pipe);
    stepper(p, { x: cw, y: 2, steps: PHASES, current: phase, accent: FG.acc, dim: FG.dim, fg: FG.fg });
    const tx = cw * 2;
    divider(p, { x: tx, y: 0, w: cw - 2, label: 'recent runs', line: FG.line, dim: FG.dim });
    const rows = s.runs.slice(0, Math.max(1, Math.floor((sub.h - 2) / 2)))
      .map((run) => ({ label: trunc(run.label ?? run.runId, cw - 3), done: !!run.accepted }));
    timeline(p, { x: tx, y: 2, rows, accent: FG.ok, fg: FG.fg, dim: FG.dim });
  });
}
