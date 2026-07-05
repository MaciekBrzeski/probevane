// Collection widgets — text-composed, so they render identically in both
// backends via the Painter's text primitive.

import type { Painter } from '../painter';
import type { Rect } from '../geom';

export interface ListModel { rect: Rect; items: string[]; selected: number; accent: number; dim: number }
/** A vertical list; the selected row is marked ▸ and highlighted. */
export function list(p: Painter, m: ListModel): void {
  const { x, y } = m.rect;
  m.items.forEach((it, i) => {
    const sel = i === m.selected;
    p.text(x, y + i, (sel ? '▸ ' : '  ') + it, { fill: sel ? m.accent : m.dim, bold: sel });
  });
}

export interface Column { header: string; width: number }
export interface TableModel { rect: Rect; columns: Column[]; rows: string[][]; accent: number; dim: number; fg: number }
/** A header row + data rows in fixed-width columns (first column in accent). */
export function table(p: Painter, m: TableModel): void {
  const { x, y } = m.rect;
  const colX = (c: number): number => x + m.columns.slice(0, c).reduce((s, col) => s + col.width + 1, 0);
  m.columns.forEach((col, c) => p.text(colX(c), y, col.header, { fill: m.dim, bold: true }));
  m.rows.forEach((row, r) => row.forEach((cell, c) => p.text(colX(c), y + 1 + r, cell, { fill: c === 0 ? m.accent : m.fg })));
}

export interface TabsModel { x: number; y: number; tabs: string[]; active: number; accent: number; dim: number }
/** A horizontal tab strip; the active tab gets » « markers + accent. */
export function tabs(p: Painter, m: TabsModel): void {
  let cx = m.x;
  m.tabs.forEach((tb, i) => {
    const on = i === m.active;
    const label = (on ? '» ' : '  ') + tb + (on ? ' «' : '  ');
    p.text(cx, m.y, label, { fill: on ? m.accent : m.dim, bold: on });
    cx += [...label].length + 1;
  });
}

export interface KeyValueModel { rect: Rect; pairs: { k: string; v: string }[]; keyW: number; accent: number; dim: number }
/** Aligned key/value rows (dim keys, accent values). */
export function keyValue(p: Painter, m: KeyValueModel): void {
  const { x, y } = m.rect;
  m.pairs.forEach((kv, i) => {
    p.text(x, y + i, kv.k, { fill: m.dim });
    p.text(x + m.keyW, y + i, kv.v, { fill: m.accent, bold: true });
  });
}
