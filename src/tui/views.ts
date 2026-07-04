// Pure pane painters for the TUI — each takes daemon data + a box rect and
// paints into a Screen. No I/O, no tty; testable by serializing the Screen and
// asserting substrings. The tui-app driver arranges the rects + flushes.

import { putText, type Screen, type Style } from './screen.js';
import { lcarsFrame } from './frame.js';
import { sparkline, pad, trunc, statusStyle, lamp, FG } from './draw.js';
import { pulse, glow, gaugeBar } from './anim.js';
import { tabSlots, tabLabel } from './tabs.js';
import { fitColumns, renderColumns } from './table.js';
import { graphFits, renderGraph } from './graph.js';
import { gauges as gaugeSpecs, packed, RUN_COLUMNS } from '../ui/theme.js';
import type { ConstellationNode } from '../observe/constellation.js';
import type { Project } from './panes.js';
import type { PipelineState } from '../observe/pipeline.js';

export interface Rect { x: number; y: number; w: number; h: number }

export interface Health { version?: string; uptimeSec?: number; ledgers?: number }
export interface Totals { totalCost?: number; acceptRate?: number; runs?: number }
export interface Daily { date: string; cost: number; tokensOut?: number }
export interface Job { op: string; dir: string; status: string; startedAt: string }
export interface Rune { name: string }
export interface Alert { kind: string; severity: string; message: string }
export interface RunRow {
  runId: string; label?: string; accepted?: boolean; stopReason?: string;
  cost?: number; ts?: string; model?: string; steps?: number;
}

/** The whole daemon snapshot the panes render — shared by the tui driver + screens. */
export interface Snapshot {
  health: Health; totals: Totals; daily: Daily[];
  jobs: Job[]; runs: RunRow[]; runes: Rune[]; alerts: Alert[]; hubs: ConstellationNode[];
  projects: Project[]; wikiPages: string[]; ops: string[];
}

const DIM: Style = { fg: FG.dim };
const ACC: Style = { fg: FG.acc, bold: true };

/** LCARS tab bar on row 0 — the active tab glows (breathing pulse), rest dim. */
export function tabBar(scr: Screen, tabs: readonly string[], active: number, t: number): void {
  const slots = tabSlots(tabs);
  tabs.forEach((name, i) => {
    const on = i === active;
    const st: Style = on ? { fg: glow(FG.acc, pulse(t, 1600)), bold: true } : DIM;
    putText(scr, slots[i].start, 0, tabLabel(name, on), st);
  });
}

/** Top-right status strip: version/uptime + headline stats (tabs own the left). */
export function statusStrip(scr: Screen, h: Health, t: Totals): void {
  const up = h.uptimeSec !== undefined ? `${Math.floor(h.uptimeSec / 60)}m` : '—';
  const s = `v${h.version ?? '?'} · up ${up} · $${(t.totalCost ?? 0).toFixed(2)} · ${Math.round((t.acceptRate ?? 0) * 100)}% · ${t.runs ?? 0} runs`;
  putText(scr, Math.max(0, scr.w - s.length - 1), 0, s, DIM);
}

/** Cost-per-day sparkline pane. */
export function costPane(scr: Screen, r: Rect, daily: Daily[]): void {
  lcarsFrame(scr, r, 'cost / day', FG.acc);
  const spark = sparkline(daily.map((d) => d.cost), r.w - 4);
  putText(scr, r.x + 2, r.y + Math.floor(r.h / 2), spark, ACC);
  const last = daily[daily.length - 1];
  if (last) putText(scr, r.x + 2, r.y + r.h - 2, trunc(`${last.date}  $${last.cost.toFixed(2)}`, r.w - 4), DIM);
}

/** Rune pipeline pane — capsules with a lamp per rune, coloured by state; active lamps pulse. */
export function pipelinePane(scr: Screen, r: Rect, runes: Rune[], state: PipelineState, t = 0): void {
  lcarsFrame(scr, r, 'run pipeline', FG.acc);
  if (!runes.length) { putText(scr, r.x + 2, r.y + 1, 'pipeline unavailable', DIM); return; }
  // The chain is inherently linear (each rune depends on the prior), so a
  // reading-order grid IS the layered-DAG layout — wrap to the pane width.
  const perRow = Math.max(1, Math.floor((r.w - 4) / 16));
  runes.forEach((rn, i) => {
    const x = r.x + 2 + (i % perRow) * 16;
    const y = r.y + 1 + Math.floor(i / perRow);
    if (y >= r.y + r.h - 1) return;
    const lp = lamp(state[rn.name] ?? 'idle');
    const st = state[rn.name] === 'active' ? { ...lp.st, fg: glow(FG.acc, pulse(t, 900)) } : lp.st;
    putText(scr, x, y, lp.ch, st);
    putText(scr, x + 2, y, pad(rn.name, 12), state[rn.name] ? st : DIM);
  });
}

const LABEL_W = 12; // gauge/spark label column
/** Animation clock for the gauge panes ({ t: ms, reveal: 0..1 sweep }). */
export interface GaugeAnim { t: number; reveal: number }

/** Draw the telemetry gauge bars (no frame) starting at row y0 — shared by the panes below. */
function drawGauges(scr: Screen, r: Rect, t: Totals, a: GaugeAnim, y0: number): number {
  const gs = gaugeSpecs(t);
  const bw = Math.max(4, r.w - LABEL_W - 10);
  const barX = r.x + 2 + LABEL_W;
  gs.forEach((g, i) => {
    const y = y0 + i * 2;
    if (y >= r.y + r.h - 1) return;
    const col = packed(g.accent);
    putText(scr, r.x + 2, y, pad(g.label, LABEL_W), DIM);
    putText(scr, barX, y, gaugeBar(g.value, bw, a.reveal), { fg: glow(col, pulse(a.t, 1400)), bold: true });
    putText(scr, barX + bw + 2, y, g.raw, { fg: col, bold: true });
  });
  return y0 + gs.length * 2; // next free row
}

/** Standalone telemetry gauges (Cost tab). */
export function gaugePane(scr: Screen, r: Rect, t: Totals, a: GaugeAnim): void {
  lcarsFrame(scr, r, 'telemetry', FG.warn);
  drawGauges(scr, r, t, a, r.y + 1);
}

/** Console telemetry pane — the browser's `telemetry` region: gauges + cost & tokens sparklines. */
export function telemetryPane(scr: Screen, r: Rect, t: Totals, daily: Daily[], a: GaugeAnim): void {
  lcarsFrame(scr, r, 'telemetry', FG.warn);
  const bottom = r.y + r.h - 1;
  const sparkW = r.w - LABEL_W - 4;
  const spark = (y: number, label: string, vals: number[], col: number) => {
    if (y >= bottom) return;
    putText(scr, r.x + 2, y, pad(label, LABEL_W), DIM);
    putText(scr, r.x + 2 + LABEL_W, y, sparkline(vals, sparkW), { fg: col, bold: true });
  };
  const sy = drawGauges(scr, r, t, a, r.y + 1) + 1;
  spark(sy, 'cost / day', daily.map((d) => d.cost), FG.acc);
  spark(sy + 1, 'tokens/day', daily.map((d) => d.tokensOut ?? 0), FG.mag);
}

/** Console module-constellation pane — an animated node graph when the pane fits, else a ranked hub list. */
export function constellationPane(scr: Screen, r: Rect, hubs: ConstellationNode[], t = 0): void {
  lcarsFrame(scr, r, 'module constellation', FG.mag);
  if (!hubs.length) { putText(scr, r.x + 2, r.y + 1, 'graph unavailable', DIM); return; }
  if (graphFits(r, hubs.length)) return renderGraph(scr, r, hubs, t);
  const bw = Math.max(3, r.w - LABEL_W - 10);
  hubs.slice(0, r.h - 2).forEach((n, i) => {
    const y = r.y + 1 + i;
    const col = n.callsNetwork ? FG.err : FG.mag;
    putText(scr, r.x + 2, y, pad(n.label, LABEL_W), n.callsNetwork ? { fg: FG.err } : DIM);
    putText(scr, r.x + 2 + LABEL_W, y, gaugeBar(n.weight, bw), { fg: col, bold: true });
  });
}

/** Active jobs + newest runs, rendered with the shared RUN_COLUMNS (same columns as the browser table). */
export function jobsPane(scr: Screen, r: Rect, jobs: Job[], runs: RunRow[]): void {
  lcarsFrame(scr, r, 'runs', FG.mag);
  const active = jobs.filter((j) => j.status === 'running');
  let y = r.y + 1;
  const line = (s: string, st: Style) => { if (y < r.y + r.h - 1) putText(scr, r.x + 2, y++, trunc(s, r.w - 4), st); };
  line(active.length ? `▶ ${active.length} active` : 'no active runs', active.length ? ACC : DIM);
  for (const j of active.slice(0, 3)) line(`  ${j.op} · ${j.dir.split('/').pop()}`, statusStyle('running'));
  const layout = fitColumns(RUN_COLUMNS, r.w - 4);
  const headerSt: Style = { ...DIM, bold: true };
  const headers = layout.map((L) => ({ text: L.col.header, st: headerSt }));
  if (y < r.y + r.h - 1) renderColumns(scr, r.x + 2, y++, layout, headers);
  for (const rn of runs) {
    if (y >= r.y + r.h - 1) break;
    renderColumns(scr, r.x + 2, y++, layout, layout.map((L) => {
      const text = L.col.get(rn);
      const st: Style = L.col.id === 'status' ? statusStyle(rn.accepted ? 'accepted' : text)
        : L.col.muted ? DIM : { fg: FG.fg };
      return { text, st };
    }));
  }
}

/** First screen row of the selectable run list inside the jobs pane (past the box, active summary, active jobs, and column header). */
export function runRowStart(r: Rect, activeCount: number): number {
  return r.y + 1 + 1 + Math.min(3, activeCount) + 1; // box top + "N active" line + active jobs + column header
}

/** Run index at a clicked screen y within the jobs pane (or -1 outside the list). */
export function runIndexAt(r: Rect, activeCount: number, y: number): number {
  const start = runRowStart(r, activeCount);
  const idx = y - start;
  return idx >= 0 && y < r.y + r.h - 1 ? idx : -1;
}

/** Alerts pane. */
export function alertsPane(scr: Screen, r: Rect, alerts: Alert[]): void {
  lcarsFrame(scr, r, 'alerts', FG.warn);
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

/** Launch input bar over the footer row (shown while typing a command). */
export function inputBar(scr: Screen, prompt: string, buf: string): void {
  const y = scr.h - 1;
  for (let x = 0; x < scr.w; x++) putText(scr, x, y, ' ', {}); // clear the row
  putText(scr, 1, y, prompt, { fg: FG.acc, bold: true });
  putText(scr, 1 + prompt.length, y, trunc(buf + '▏', scr.w - prompt.length - 2), { fg: FG.fg });
}
