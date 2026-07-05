// State widgets — skeleton (loading placeholder), emptyState (nothing-here
// callout), scrollbar (overflow indicator). Text/rect composed → both backends.

import type { Painter } from '../painter';
import type { Rect } from '../geom';
import { clamp } from '../geom';

export interface SkeletonModel { rect: Rect; color: number; lines?: number }
/** Loading placeholder — staggered-width filled bars, one per row. */
export function skeleton(p: Painter, m: SkeletonModel): void {
  const { x, y, w, h } = m.rect;
  const lines = m.lines ?? h;
  for (let i = 0; i < lines; i++) {
    const lw = Math.max(1, Math.round(w * (i % 2 ? 0.6 : 0.85)));
    p.rect(x, y + i, lw, 1, { fill: m.color });
  }
}

export interface EmptyStateModel { rect: Rect; icon: string; title: string; hint?: string; accent: number; dim: number }
/** Centred nothing-here callout — icon over a title (+ optional hint). */
export function emptyState(p: Painter, m: EmptyStateModel): void {
  const { x, y, w, h } = m.rect;
  const cx = x + w / 2, cy = y + Math.floor(h / 2);
  p.text(cx, cy - 1, m.icon, { fill: m.accent, align: 'c', bold: true });
  p.text(cx, cy, m.title, { fill: m.dim, align: 'c' });
  if (m.hint) p.text(cx, cy + 1, m.hint, { fill: m.dim, align: 'c' });
}

export interface ScrollbarModel { x: number; y: number; h: number; total: number; visible: number; offset: number; color: number; track: number }
/** Vertical scrollbar — track + a thumb sized/positioned from total/visible/offset. */
export function scrollbar(p: Painter, m: ScrollbarModel): void {
  p.rect(m.x, m.y, 1, m.h, { fill: m.track });
  const frac = clamp(m.visible / Math.max(1, m.total), 0, 1);
  const th = Math.max(1, Math.round(m.h * frac));
  const maxOff = Math.max(1, m.total - m.visible);
  const ty = m.y + Math.round((m.h - th) * clamp(m.offset / maxOff, 0, 1));
  p.rect(m.x, ty, 1, th, { fill: m.color });
}
