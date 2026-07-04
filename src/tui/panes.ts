// Parity panes for the TUI — the terminal read of the browser's Projects, Docs,
// Launch, Quality, and Terminal tabs. Pure painters (screen + rect in, cells
// out); the tui-app driver fetches the data + owns selection. Kept out of
// views.ts so both files stay under the size ceiling.

import { putText, type Screen, type Style } from './screen.js';
import { lcarsFrame } from './frame.js';
import { pad, trunc, FG } from './draw.js';

export interface Project {
  name: string; runCount?: number; acceptRate?: number;
  lastRun?: { op?: string; accepted?: boolean; stopReason?: string } | null;
}

const DIM: Style = { fg: FG.dim };
const ACC: Style = { fg: FG.acc, bold: true };
const FGC: Style = { fg: FG.fg };
const clip = (scr: Screen, r: Rect) => (s: string) => trunc(s, r.w - 4);
interface Rect { x: number; y: number; w: number; h: number }

/** Project cards → a ranked list: name, run count, accept %, last outcome. */
export function projectsPane(scr: Screen, r: Rect, projects: Project[]): void {
  lcarsFrame(scr, r, 'projects', FG.acc);
  const t = clip(scr, r);
  let y = r.y + 1;
  const line = (s: string, st: Style) => { if (y < r.y + r.h - 1) putText(scr, r.x + 2, y++, t(s), st); };
  if (!projects.length) { line('no projects', DIM); return; }
  line(`${pad('project', 26)} ${pad('runs', 6)} ${pad('accept', 7)} last`, { ...DIM, bold: true });
  for (const p of projects) {
    const acc = p.acceptRate != null ? `${Math.round(p.acceptRate * 100)}%` : '—';
    const last = p.lastRun ? `${p.lastRun.op ?? ''}:${p.lastRun.accepted ? 'accepted' : p.lastRun.stopReason ?? '?'}` : '—';
    line(`${pad(p.name, 26)} ${pad(String(p.runCount ?? 0), 6)} ${pad(acc, 7)} ${last}`, FGC);
  }
}

/** A titled, selectable list (docs page list, op list). `sel` < 0 = no selection. */
export function listPane(scr: Screen, r: Rect, title: string, accent: number, items: string[], sel: number): void {
  lcarsFrame(scr, r, title, accent);
  if (!items.length) { putText(scr, r.x + 2, r.y + 1, '—', DIM); return; }
  items.slice(0, r.h - 2).forEach((it, i) => {
    const on = i === sel;
    putText(scr, r.x + 2, r.y + 1 + i, trunc((on ? '▸ ' : '  ') + it, r.w - 4), on ? ACC : DIM);
  });
}

/** A titled body of pre-split text lines (wiki page, quality scorecard, hint). */
export function textPane(scr: Screen, r: Rect, title: string, accent: number, lines: string[]): void {
  lcarsFrame(scr, r, title, accent);
  const t = clip(scr, r);
  lines.slice(0, r.h - 2).forEach((ln, i) => putText(scr, r.x + 2, r.y + 1 + i, t(ln), FGC));
}
