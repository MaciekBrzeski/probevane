// Input widgets — form controls as static visual states (checked / focused /
// value are props, not behaviour). Authored once against Painter; text-composed
// glyph controls render identically in both backends, geometric ones (slider,
// toggle, field boxes) rasterize to box-drawing / braille in cells.

import type { Painter } from '../painter';
import type { Rect } from '../geom';
import { clamp } from '../geom';

export interface CheckboxModel { x: number; y: number; label: string; checked: boolean; accent: number; dim: number }
/** A checkbox + label; checked shows ✓ in accent. */
export function checkbox(p: Painter, m: CheckboxModel): void {
  const col = m.checked ? m.accent : m.dim;
  p.text(m.x, m.y, m.checked ? '[✓]' : '[ ]', { fill: col, bold: m.checked });
  p.text(m.x + 4, m.y, m.label, { fill: m.checked ? m.accent : m.dim });
}

export interface RadioModel { x: number; y: number; label: string; selected: boolean; accent: number; dim: number }
/** A radio button + label; selected shows • in accent. */
export function radio(p: Painter, m: RadioModel): void {
  const col = m.selected ? m.accent : m.dim;
  p.text(m.x, m.y, m.selected ? '(•)' : '( )', { fill: col, bold: m.selected });
  p.text(m.x + 4, m.y, m.label, { fill: m.selected ? m.accent : m.dim });
}

export interface ToggleModel { x: number; y: number; on: boolean; accent: number; track: number; knob: number }
/** A switch — track pill with the knob at the on/off end. */
export function toggle(p: Painter, m: ToggleModel): void {
  p.rect(m.x, m.y - 0.4, 5, 1.4, { fill: m.on ? m.accent : m.track, stroke: m.on ? m.accent : m.track });
  p.text(m.on ? m.x + 3.5 : m.x + 1.5, m.y, '●', { fill: m.knob, align: 'c' });
}

export interface SliderModel { rect: { x: number; y: number; w: number }; value: number; accent: number; track: number; knob?: number }
/** A horizontal slider — track line, accent fill to the knob (value 0..1). */
export function slider(p: Painter, m: SliderModel): void {
  const { x, y, w } = m.rect;
  const kx = x + w * clamp(m.value, 0, 1);
  p.line(x, y, x + w, y, { stroke: m.track });
  p.line(x, y, kx, y, { stroke: m.accent });
  p.text(kx, y, '●', { fill: m.knob ?? m.accent, align: 'c' });
}

export interface TextFieldModel { rect: Rect; label?: string; value: string; accent: number; dim: number; fg: number; focused?: boolean }
/** A labelled text field — box (accent border when focused) + value + caret. */
export function textField(p: Painter, m: TextFieldModel): void {
  const { x, y, w, h } = m.rect;
  const by = m.label ? y + 1 : y;
  if (m.label) p.text(x, y, m.label, { fill: m.focused ? m.accent : m.dim });
  p.rect(x, by, w, h, { stroke: m.focused ? m.accent : m.dim });
  p.text(x + 2, by + Math.floor(h / 2), m.value + (m.focused ? '▏' : ''), { fill: m.fg });
}

export interface SelectModel { rect: Rect; value: string; accent: number; dim: number; fg: number; open?: boolean }
/** A select / dropdown — box + value + ▾ chevron (accent border when open). */
export function select(p: Painter, m: SelectModel): void {
  const { x, y, w, h } = m.rect;
  p.rect(x, y, w, h, { stroke: m.open ? m.accent : m.dim });
  p.text(x + 2, y + Math.floor(h / 2), m.value, { fill: m.fg });
  p.text(x + w - 2, y + Math.floor(h / 2), '▾', { fill: m.accent });
}
