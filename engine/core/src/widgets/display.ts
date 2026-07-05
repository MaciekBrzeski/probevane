// Data-display widgets — avatar, chip, card, divider, stat, accordion, tree,
// timeline. Structure/state are props (expanded, done, delta). Text-composed
// where possible for exact backend parity; boxes/connectors otherwise.

import type { Painter } from '../painter';
import type { Rect } from '../geom';

export interface AvatarModel { x: number; y: number; initials: string; accent: number; fg: number }
/** A small avatar chip carrying initials. */
export function avatar(p: Painter, m: AvatarModel): void {
  p.rect(m.x, m.y, 4, 3, { fill: m.accent, stroke: m.accent });
  p.text(m.x + 2, m.y + 1, m.initials.slice(0, 2), { fill: m.fg, align: 'c', bold: true });
}

export interface ChipModel { x: number; y: number; text: string; accent: number; fg: number; filled?: boolean }
/** A rounded chip / tag; `filled` inverts, else outlined. */
export function chip(p: Painter, m: ChipModel): void {
  const w = [...m.text].length + 4;
  p.rect(m.x, m.y, w, 1, m.filled ? { fill: m.accent, stroke: m.accent } : { stroke: m.accent });
  p.text(m.x + w / 2, m.y, m.text, { fill: m.filled ? m.fg : m.accent, align: 'c' });
}

export interface CardModel { rect: Rect; title: string; lines: string[]; accent: number; fg: number; dim: number; panel: number }
/** A surface card — panel fill, title, divider, body lines. */
export function card(p: Painter, m: CardModel): void {
  const { x, y, w, h } = m.rect;
  p.rect(x, y, w, h, { fill: m.panel, stroke: m.dim });
  p.text(x + 2, y + 1, m.title, { fill: m.accent, bold: true });
  p.line(x + 1, y + 2, x + w - 1, y + 2, { stroke: m.dim });
  m.lines.forEach((ln, i) => p.text(x + 2, y + 3 + i, ln, { fill: m.fg }));
}

export interface DividerModel { x: number; y: number; w: number; label?: string; line: number; dim: number }
/** A horizontal rule with an optional centred label. */
export function divider(p: Painter, m: DividerModel): void {
  if (!m.label) { p.line(m.x, m.y, m.x + m.w, m.y, { stroke: m.line }); return; }
  const lab = ` ${m.label} `;
  const side = Math.max(1, Math.floor((m.w - [...lab].length) / 2));
  p.line(m.x, m.y, m.x + side, m.y, { stroke: m.line });
  p.text(m.x + side, m.y, lab, { fill: m.dim });
  p.line(m.x + side + [...lab].length, m.y, m.x + m.w, m.y, { stroke: m.line });
}

export interface StatModel { x: number; y: number; label: string; value: string; delta?: string; accent: number; fg: number; dim: number }
/** A metric — big value, label, optional coloured delta. */
export function stat(p: Painter, m: StatModel): void {
  p.text(m.x, m.y, m.label, { fill: m.dim });
  p.text(m.x, m.y + 1, m.value, { fill: m.fg, bold: true });
  if (m.delta) p.text(m.x + [...m.value].length + 1, m.y + 1, m.delta, { fill: m.accent });
}

export interface AccordionRow { title: string; open: boolean; body?: string }
export interface AccordionModel { rect: Rect; rows: AccordionRow[]; accent: number; fg: number; dim: number }
/** An accordion — ▾/▸ header rows; open rows reveal a body line. */
export function accordion(p: Painter, m: AccordionModel): void {
  const { x, y } = m.rect;
  let cy = y;
  for (const row of m.rows) {
    p.text(x, cy, `${row.open ? '▾' : '▸'} ${row.title}`, { fill: row.open ? m.accent : m.fg, bold: row.open });
    cy++;
    if (row.open && row.body) { p.text(x + 2, cy, row.body, { fill: m.dim }); cy++; }
  }
}

export interface TreeRow { depth: number; label: string; last: boolean }
export interface TreeModel { x: number; y: number; rows: TreeRow[]; accent: number; fg: number; dim: number }
/** A tree — indented rows with ├─/└─ connectors. */
export function tree(p: Painter, m: TreeModel): void {
  m.rows.forEach((r, i) => {
    const indent = '  '.repeat(Math.max(0, r.depth - 1));
    const branch = r.depth === 0 ? '' : (r.last ? '└─ ' : '├─ ');
    p.text(m.x, m.y + i, indent + branch, { fill: m.dim });
    p.text(m.x + indent.length + branch.length, m.y + i, r.label, { fill: r.depth === 0 ? m.accent : m.fg, bold: r.depth === 0 });
  });
}

export interface TimelineRow { label: string; done: boolean }
export interface TimelineModel { x: number; y: number; rows: TimelineRow[]; accent: number; fg: number; dim: number }
/** A vertical timeline — ● nodes joined by │, done nodes in accent. */
export function timeline(p: Painter, m: TimelineModel): void {
  m.rows.forEach((r, i) => {
    if (i > 0) p.text(m.x, m.y + i * 2 - 1, '│', { fill: m.dim });
    p.text(m.x, m.y + i * 2, r.done ? '●' : '○', { fill: r.done ? m.accent : m.dim });
    p.text(m.x + 2, m.y + i * 2, r.label, { fill: r.done ? m.fg : m.dim });
  });
}
