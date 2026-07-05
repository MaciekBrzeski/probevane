// SvgPainter — the browser backend. Emits SVG primitives (crisp vectors). Honours
// the SVG-hint Style fields (tag→class, pathLength, data-*, gradient) so a DOM
// consumer keeps its CSS animation / gradients / interactivity when it adopts a
// widget. Kept DOM-free (scene-item list + string) so it parity-tests in node.

import type { Painter, Caps, Pt, Style } from '@facet/core';
import { hex } from '@facet/core';

export interface SvgItem { tag: 'rect' | 'line' | 'polyline' | 'polygon' | 'path' | 'text' | 'circle'; attrs: Record<string, string | number>; text?: string }

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

export class SvgPainter implements Painter {
  readonly caps: Caps = { subpixel: true, curves: true, glyphGrid: false, cellW: 1, cellH: 1 };
  readonly items: SvgItem[] = [];
  private stack: Pt[] = [];
  private gradients = new Map<number, string>();

  constructor(public readonly w: number, public readonly h: number) {}

  private ox(): number { return this.stack.reduce((s, p) => s + p.x, 0); }
  private oy(): number { return this.stack.reduce((s, p) => s + p.y, 0); }

  // Common SVG-hint attrs applied to every element.
  private hint(st: Style): Record<string, string | number> {
    const a: Record<string, string | number> = {};
    if (st.tag) a.class = st.tag;
    if (st.pathLength !== undefined) a.pathLength = st.pathLength;
    for (const [k, v] of Object.entries(st.data ?? {})) a[`data-${k}`] = v;
    return a;
  }
  private stroke(st: Style): Record<string, string | number> {
    const grad = st.gradient && st.fill !== undefined;
    const a: Record<string, string | number> = { fill: st.fill !== undefined ? (grad ? `url(#${this.gradId(st.fill)})` : hex(st.fill)) : 'none' };
    if (st.stroke !== undefined) { a.stroke = hex(st.stroke); a['stroke-width'] = st.width ?? 1; a['stroke-linecap'] = 'round'; }
    if (st.dash) a['stroke-dasharray'] = st.dash;
    return { ...a, ...this.hint(st) };
  }
  private gradId(color: number): string {
    let id = this.gradients.get(color);
    if (!id) { id = `fg${this.gradients.size}`; this.gradients.set(color, id); }
    return id;
  }

  push(dx: number, dy: number): void { this.stack.push({ x: dx, y: dy }); }
  pop(): void { this.stack.pop(); }

  rect(x: number, y: number, w: number, h: number, st: Style): void {
    this.items.push({ tag: 'rect', attrs: { x: x + this.ox(), y: y + this.oy(), width: w, height: h, ...this.stroke(st) } });
  }
  line(x0: number, y0: number, x1: number, y1: number, st: Style): void {
    this.items.push({ tag: 'line', attrs: { x1: x0 + this.ox(), y1: y0 + this.oy(), x2: x1 + this.ox(), y2: y1 + this.oy(), ...this.stroke(st) } });
  }
  polyline(pts: Pt[], st: Style): void {
    this.items.push({ tag: 'polyline', attrs: { points: this.points(pts), ...this.stroke(st) } });
  }
  polygon(pts: Pt[], st: Style): void {
    this.items.push({ tag: 'polygon', attrs: { points: this.points(pts), ...this.stroke(st) } });
  }
  circle(cx: number, cy: number, r: number, st: Style): void {
    this.items.push({ tag: 'circle', attrs: { cx: cx + this.ox(), cy: cy + this.oy(), r, ...this.stroke(st) } });
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, st: Style): void {
    const ox = this.ox(), oy = this.oy();
    const x0 = cx + ox + r * Math.cos(a0), y0 = cy + oy + r * Math.sin(a0);
    const x1 = cx + ox + r * Math.cos(a1), y1 = cy + oy + r * Math.sin(a1);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    this.items.push({ tag: 'path', attrs: { d: `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`, ...this.stroke(st) } });
  }
  text(x: number, y: number, str: string, st: Style): void {
    const anchor = st.align === 'c' ? 'middle' : st.align === 'r' ? 'end' : 'start';
    this.items.push({
      tag: 'text',
      attrs: { x: x + this.ox(), y: y + this.oy(), fill: hex(st.fill ?? st.stroke ?? 0xffffff), 'text-anchor': anchor, 'font-weight': st.bold ? 700 : 400, ...this.hint(st) },
      text: str,
    });
  }

  private points(pts: Pt[]): string { return pts.map((p) => `${p.x + this.ox()},${p.y + this.oy()}`).join(' '); }

  private defs(): string {
    if (!this.gradients.size) return '';
    const grads = [...this.gradients.entries()].map(([color, id]) =>
      `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${hex(color)}" stop-opacity="0.35"/><stop offset="1" stop-color="${hex(color)}" stop-opacity="0"/>` +
      `</linearGradient>`).join('');
    return `<defs>${grads}</defs>`;
  }

  toSvg(): string {
    const body = this.items.map((it) => {
      const at = Object.entries(it.attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
      return it.tag === 'text' ? `<text ${at}>${esc(it.text ?? '')}</text>` : `<${it.tag} ${at}/>`;
    }).join('');
    return `<svg viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}">${this.defs()}${body}</svg>`;
  }
}
