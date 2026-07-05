// Parity panes for the TUI — the terminal read of the browser's Projects, Docs,
// Launch, Quality, and Terminal tabs. Pure painters (screen + rect in, cells
// out); the tui-app driver fetches the data + owns selection. Kept out of
// views.ts so both files stay under the size ceiling.

import { putText, type Screen, type Style } from './screen.js';
import { lcarsFrame } from './frame.js';
import { trunc, FG } from './draw.js';
import { paintWidget } from './facet.js';
import { card, badge, progress, menu, type Painter } from '@facet/core';

export interface Project {
  name: string; runCount?: number; acceptRate?: number;
  lastRun?: { op?: string; accepted?: boolean; stopReason?: string } | null;
}

const DIM: Style = { fg: FG.dim };
const ACC: Style = { fg: FG.acc, bold: true };
const FGC: Style = { fg: FG.fg };
const clip = (scr: Screen, r: Rect) => (s: string) => trunc(s, r.w - 4);
interface Rect { x: number; y: number; w: number; h: number }

function lastOutcome(p: Project): string {
  if (!p.lastRun) return '—';
  const status = p.lastRun.accepted ? 'accepted' : p.lastRun.stopReason ?? '?';
  return `${p.lastRun.op ?? ''}:${status}`;
}

const CARD_H = 6;
/** One project rendered as a facet card: name, run-count badge, accept-rate bar, last outcome. */
function projectCard(p: Painter, b: Rect, pr: Project): void {
  const acc = pr.acceptRate ?? 0;
  const pct = pr.acceptRate != null ? `${Math.round(acc * 100)}%` : '—';
  card(p, { rect: b, title: pr.name, lines: [], accent: FG.acc, fg: FG.fg, dim: FG.dim, panel: FG.panel });
  badge(p, { x: b.x + b.w - 6, y: b.y + 1, text: String(pr.runCount ?? 0), accent: FG.mag, fg: FG.bg });
  p.text(b.x + 2, b.y + 3, 'accept', { fill: FG.dim });
  const bar = { x: b.x + 9, y: b.y + 3, w: Math.max(3, b.w - 16), h: 1 };
  progress(p, { rect: bar, value: acc, accent: FG.ok, track: FG.line });
  p.text(b.x + b.w - 2, b.y + 3, pct, { fill: FG.ok, align: 'r', bold: true });
  p.text(b.x + 2, b.y + 4, trunc(lastOutcome(pr), b.w - 4), { fill: pr.lastRun?.accepted ? FG.ok : FG.warn });
}

/** Project cards laid out in a responsive grid (facet card + badge + progress). */
export function projectsPane(scr: Screen, r: Rect, projects: Project[]): void {
  lcarsFrame(scr, r, 'projects', FG.acc);
  if (!projects.length) { putText(scr, r.x + 2, r.y + 1, 'no projects', DIM); return; }
  paintWidget(scr, r, (p) => {
    const cols = Math.max(1, Math.floor((r.w - 2) / 34));
    const cardW = Math.floor((r.w - 4) / cols) - 1;
    projects.forEach((pr, i) => {
      const cx = 2 + (i % cols) * (cardW + 2);
      const cy = 1 + Math.floor(i / cols) * (CARD_H + 1);
      if (cy + CARD_H >= r.h) return;
      projectCard(p, { x: cx, y: cy, w: cardW, h: CARD_H }, pr);
    });
  });
}

/** A facet dropdown menu as a pane (launch operations) — panel + rows, title on the top border. */
export function menuPane(scr: Screen, r: Rect, title: string, items: string[], sel = -1): void {
  if (!items.length) { lcarsFrame(scr, r, title, FG.acc); putText(scr, r.x + 2, r.y + 1, '—', DIM); return; }
  paintWidget(scr, r, (p) => menu(p, {
    rect: { x: 0, y: 0, w: r.w, h: r.h },
    items: items.map((label) => ({ label })), selected: sel,
    accent: FG.acc, fg: FG.fg, dim: FG.dim, panel: FG.panel,
  }));
  putText(scr, r.x + 2, r.y, ` ${title} `, ACC);
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
