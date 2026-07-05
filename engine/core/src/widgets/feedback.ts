// Feedback widgets — alerts, tooltips, dialogs, banners. Severity colour is a
// prop (caller maps info/success/warn/error → accent) so the widgets stay
// palette-agnostic. Boxes rasterize to box-drawing in cells, rects in SVG.

import type { Painter } from '../painter';
import type { Rect } from '../geom';

export interface AlertModel { rect: Rect; icon: string; title: string; message: string; accent: number; fg: number; dim: number }
/** A callout — accent left rail + icon + bold title + message. */
export function alert(p: Painter, m: AlertModel): void {
  const { x, y, w, h } = m.rect;
  p.rect(x, y, w, h, { stroke: m.accent });
  p.rect(x, y, 1, h, { fill: m.accent, stroke: m.accent });
  p.text(x + 2, y + 1, `${m.icon} ${m.title}`, { fill: m.accent, bold: true });
  p.text(x + 2, y + 2, m.message, { fill: m.fg });
}

export interface BannerModel { rect: Rect; text: string; accent: number; fg: number }
/** A full-width filled banner (accent bg, centred text). */
export function banner(p: Painter, m: BannerModel): void {
  const { x, y, w, h } = m.rect;
  p.rect(x, y, w, h, { fill: m.accent, stroke: m.accent });
  p.text(x + w / 2, y + Math.floor(h / 2), m.text, { fill: m.fg, align: 'c', bold: true });
}

export interface TooltipModel { x: number; y: number; text: string; accent: number; fg: number }
/** A tooltip bubble with a downward tail. */
export function tooltip(p: Painter, m: TooltipModel): void {
  const w = [...m.text].length + 4;
  p.rect(m.x, m.y, w, 3, { fill: m.accent, stroke: m.accent });
  p.text(m.x + 2, m.y + 1, m.text, { fill: m.fg, bold: true });
  p.text(m.x + Math.floor(w / 2), m.y + 3, '▾', { fill: m.accent, align: 'c' });
}

export interface DialogModel { rect: Rect; title: string; body: string; actions: string[]; accent: number; fg: number; dim: number; panel: number }
/** A modal dialog — panel, title bar, body, right-aligned action pills. */
export function dialog(p: Painter, m: DialogModel): void {
  const { x, y, w, h } = m.rect;
  p.rect(x, y, w, h, { fill: m.panel, stroke: m.accent });
  p.text(x + 2, y + 1, m.title, { fill: m.accent, bold: true });
  p.line(x + 1, y + 2, x + w - 1, y + 2, { stroke: m.dim });
  p.text(x + 2, y + 3, m.body, { fill: m.fg });
  let ax = x + w - 2;
  for (let i = m.actions.length - 1; i >= 0; i--) {
    const label = m.actions[i]!;
    const bw = [...label].length + 2;
    ax -= bw + 1;
    const primary = i === m.actions.length - 1;
    p.rect(ax, y + h - 2, bw, 1, primary ? { fill: m.accent, stroke: m.accent } : { stroke: m.dim });
    p.text(ax + bw / 2, y + h - 2, label, { fill: primary ? m.panel : m.fg, align: 'c', bold: primary });
  }
}
