// Navigation widgets — breadcrumb, pagination, stepper, menu. Text-composed
// (identical in both backends); the stepper's connectors are axis lines.

import type { Painter } from '../painter';
import type { Rect } from '../geom';

export interface BreadcrumbModel { x: number; y: number; crumbs: string[]; accent: number; dim: number }
/** A breadcrumb trail — crumbs joined by ›, the last in accent. */
export function breadcrumb(p: Painter, m: BreadcrumbModel): void {
  let cx = m.x;
  m.crumbs.forEach((c, i) => {
    const last = i === m.crumbs.length - 1;
    p.text(cx, m.y, c, { fill: last ? m.accent : m.dim, bold: last });
    cx += [...c].length;
    if (!last) { p.text(cx + 1, m.y, '›', { fill: m.dim }); cx += 3; }
  });
}

export interface PaginationModel { x: number; y: number; pages: number; current: number; accent: number; dim: number }
/** A pager — ‹ 1 2 [3] 4 › with the current page boxed in accent. */
export function pagination(p: Painter, m: PaginationModel): void {
  let cx = m.x;
  p.text(cx, m.y, '‹', { fill: m.dim }); cx += 2;
  for (let i = 1; i <= m.pages; i++) {
    const on = i === m.current;
    const label = on ? `[${i}]` : ` ${i} `;
    p.text(cx, m.y, label, { fill: on ? m.accent : m.dim, bold: on });
    cx += [...label].length;
  }
  p.text(cx, m.y, '›', { fill: m.dim });
}

export interface StepperModel { x: number; y: number; steps: string[]; current: number; accent: number; dim: number; fg: number }
/** A horizontal stepper — ①②③ nodes joined by ─, each label centred beneath its
 *  node; reached steps in accent, the current one bold. */
export function stepper(p: Painter, m: StepperModel): void {
  const nums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
  const gap = Math.max(6, Math.max(...m.steps.map((s) => [...s].length)) + 3);
  const half = Math.max(...m.steps.map((s) => [...s].length)) >> 1;
  m.steps.forEach((label, i) => {
    const nx = m.x + half + 1 + i * gap;
    const reached = i <= m.current;
    if (i > 0) p.line(nx - gap + 1, m.y, nx - 1, m.y, { stroke: i <= m.current ? m.accent : m.dim });
    p.text(nx, m.y, nums[i] ?? '●', { fill: reached ? m.accent : m.dim, bold: i === m.current });
    p.text(nx, m.y + 1, label, { fill: i === m.current ? m.fg : m.dim, align: 'c' });
  });
}

export interface MenuItem { label: string; shortcut?: string }
export interface MenuModel { rect: Rect; items: MenuItem[]; selected: number; accent: number; fg: number; dim: number; panel: number }
/** A dropdown menu — panel, rows with label + right-aligned shortcut. */
export function menu(p: Painter, m: MenuModel): void {
  const { x, y, w, h } = m.rect;
  p.rect(x, y, w, h, { fill: m.panel, stroke: m.dim });
  m.items.forEach((it, i) => {
    const on = i === m.selected;
    if (on) p.rect(x + 1, y + 1 + i, w - 2, 1, { fill: m.accent });
    p.text(x + 2, y + 1 + i, it.label, { fill: on ? m.panel : m.fg, bold: on });
    if (it.shortcut) p.text(x + w - 2 - [...it.shortcut].length, y + 1 + i, it.shortcut, { fill: on ? m.panel : m.dim });
  });
}
