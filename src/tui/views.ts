// Pure pane painters for the TUI — each takes daemon data + a box rect and
// paints into a Screen. No I/O, no tty; testable by serializing the Screen and
// asserting substrings. The tui-app driver arranges the rects + flushes.

import { putText, box, type Screen, type Style } from './screen.js';
import { sparkline, pad, trunc, statusStyle, lamp, FG } from './draw.js';
import type { PipelineState } from '../observe/pipeline.js';

export interface Rect { x: number; y: number; w: number; h: number }

export interface Health { version?: string; uptimeSec?: number; ledgers?: number }
export interface Totals { totalCost?: number; acceptRate?: number; runs?: number }
export interface Daily { date: string; cost: number }
export interface Job { op: string; dir: string; status: string; startedAt: string }
export interface Rune { name: string }
export interface Alert { kind: string; severity: string; message: string }
export interface RunRow { runId: string; label?: string; accepted?: boolean; stopReason?: string; cost?: number }

const DIM: Style = { fg: FG.dim };
const ACC: Style = { fg: FG.acc, bold: true };

/** Top status bar: title + version/uptime + headline stats. */
export function header(scr: Screen, h: Health, t: Totals): void {
  putText(scr, 1, 0, 'PROBEVANE ⬡ COMMAND CENTER', ACC);
  const up = h.uptimeSec !== undefined ? `${Math.floor(h.uptimeSec / 60)}m` : '—';
  const stat = `v${h.version ?? '?'} · up ${up} · ${h.ledgers ?? 0} ledger(s)   cost $${(t.totalCost ?? 0).toFixed(2)} · accept ${Math.round((t.acceptRate ?? 0) * 100)}% · ${t.runs ?? 0} runs`;
  putText(scr, 30, 0, stat, DIM);
}

/** Cost-per-day sparkline pane. */
export function costPane(scr: Screen, r: Rect, daily: Daily[]): void {
  box(scr, r.x, r.y, r.w, r.h, 'cost / day', DIM);
  const spark = sparkline(daily.map((d) => d.cost), r.w - 4);
  putText(scr, r.x + 2, r.y + Math.floor(r.h / 2), spark, ACC);
  const last = daily[daily.length - 1];
  if (last) putText(scr, r.x + 2, r.y + r.h - 2, trunc(`${last.date}  $${last.cost.toFixed(2)}`, r.w - 4), DIM);
}

/** Rune pipeline pane — capsules with a lamp per rune, coloured by state. */
export function pipelinePane(scr: Screen, r: Rect, runes: Rune[], state: PipelineState): void {
  box(scr, r.x, r.y, r.w, r.h, 'run pipeline', { fg: FG.acc });
  if (!runes.length) { putText(scr, r.x + 2, r.y + 1, 'pipeline unavailable', DIM); return; }
  // The chain is inherently linear (each rune depends on the prior), so a
  // reading-order grid IS the layered-DAG layout — wrap to the pane width.
  const perRow = Math.max(1, Math.floor((r.w - 4) / 16));
  runes.forEach((rn, i) => {
    const x = r.x + 2 + (i % perRow) * 16;
    const y = r.y + 1 + Math.floor(i / perRow);
    if (y >= r.y + r.h - 1) return;
    const lp = lamp(state[rn.name] ?? 'idle');
    putText(scr, x, y, lp.ch, lp.st);
    putText(scr, x + 2, y, pad(rn.name, 12), state[rn.name] ? lp.st : DIM);
  });
}

/** Active jobs + newest runs. */
export function jobsPane(scr: Screen, r: Rect, jobs: Job[], runs: RunRow[]): void {
  box(scr, r.x, r.y, r.w, r.h, 'runs', DIM);
  let y = r.y + 1;
  const line = (s: string, st: Style) => { if (y < r.y + r.h - 1) putText(scr, r.x + 2, y++, trunc(s, r.w - 4), st); };
  const active = jobs.filter((j) => j.status === 'running');
  line(active.length ? `▶ ${active.length} active` : 'no active runs', active.length ? ACC : DIM);
  for (const j of active.slice(0, 3)) line(`  ${j.op} · ${j.dir.split('/').pop()}`, statusStyle('running'));
  for (const rn of runs.slice(0, r.h - 4 - Math.min(3, active.length))) {
    const status = rn.accepted ? 'accepted' : rn.stopReason ?? '?';
    line(`${pad(status, 10)} ${trunc(rn.label ?? rn.runId, r.w - 20)}`, statusStyle(rn.accepted ? 'accepted' : status));
  }
}

/** Alerts pane. */
export function alertsPane(scr: Screen, r: Rect, alerts: Alert[]): void {
  box(scr, r.x, r.y, r.w, r.h, 'alerts', { fg: FG.warn });
  if (!alerts.length) { putText(scr, r.x + 2, r.y + 1, 'none', DIM); return; }
  alerts.slice(0, r.h - 2).forEach((a, i) => {
    const st: Style = a.severity === 'error' ? { fg: FG.err, bold: true } : { fg: FG.warn };
    putText(scr, r.x + 2, r.y + 1 + i, trunc(`${a.severity === 'error' ? '🛑' : '⚠'} ${a.kind}: ${a.message}`, r.w - 4), st);
  });
}

/** Bottom key hints. */
export function footer(scr: Screen, keys: string): void {
  putText(scr, 1, scr.h - 1, keys, DIM);
}
