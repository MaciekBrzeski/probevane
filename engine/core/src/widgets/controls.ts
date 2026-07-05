// Small control widgets — authored once against Painter, rendered by both
// backends (SVG rects/text, cell box-drawing/glyphs).

import type { Painter } from '../painter';
import type { Rect } from '../geom';

export interface ButtonModel { rect: Rect; label: string; accent: number; fg: number; filled?: boolean }
/** A labelled box; `filled` inverts (accent background, fg label). */
export function button(p: Painter, m: ButtonModel): void {
  const { x, y, w, h } = m.rect;
  p.rect(x, y, w, h, m.filled ? { fill: m.accent, stroke: m.accent } : { stroke: m.accent });
  p.text(x + w / 2, y + h / 2, m.label, { fill: m.filled ? m.fg : m.accent, align: 'c', bold: true });
}

export interface BadgeModel { x: number; y: number; text: string; accent: number; fg: number }
/** A small filled pill (count / status tag). */
export function badge(p: Painter, m: BadgeModel): void {
  const w = [...m.text].length + 2;
  p.rect(m.x, m.y - 0.5, w, 1.4, { fill: m.accent, stroke: m.accent });
  p.text(m.x + w / 2, m.y, m.text, { fill: m.fg, align: 'c', bold: true });
}

export interface ProgressModel { rect: Rect; value: number; accent: number; track: number }
/** Horizontal progress bar (value 0..1) — track fill + accent fill. */
export function progress(p: Painter, m: ProgressModel): void {
  const v = m.value < 0 ? 0 : m.value > 1 ? 1 : m.value;
  const { x, y, w, h } = m.rect;
  p.rect(x, y, w, h, { fill: m.track });
  if (v > 0) p.rect(x, y, w * v, h, { fill: m.accent });
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export interface SpinnerModel { x: number; y: number; accent: number }
/** Braille spinner — `t` (ms) drives the frame. */
export function spinner(p: Painter, m: SpinnerModel, t = 0): void {
  p.text(m.x, m.y, SPIN[Math.floor(t / 80) % SPIN.length]!, { fill: m.accent, bold: true });
}

export interface ButtonGroupModel { x: number; y: number; options: string[]; active: number; accent: number; fg: number; dim: number }
/** A segmented control — a connected row of options; the active one fills accent. */
export function buttonGroup(p: Painter, m: ButtonGroupModel): void {
  let cx = m.x;
  m.options.forEach((opt, i) => {
    const w = [...opt].length + 2;
    const on = i === m.active;
    if (on) p.rect(cx, m.y, w, 1, { fill: m.accent });
    p.text(cx + w / 2, m.y, opt, { fill: on ? m.fg : m.dim, align: 'c', bold: on });
    cx += w;
  });
}

export interface RatingModel { x: number; y: number; value: number; max?: number; accent: number; dim: number }
/** A ★ rating — filled to `value`, hollow ☆ for the rest. */
export function rating(p: Painter, m: RatingModel): void {
  const max = m.max ?? 5;
  const full = Math.max(0, Math.min(max, Math.round(m.value)));
  p.text(m.x, m.y, '★'.repeat(full), { fill: m.accent, bold: true });
  p.text(m.x + full, m.y, '☆'.repeat(max - full), { fill: m.dim });
}
