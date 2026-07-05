// Ring gauge — a dim full track + an accent value arc (0..value of a full turn,
// starting at 12 o'clock) + a centred percentage. One definition: the SVG
// backend draws crisp arcs, the cell backend braille arcs.

import type { Painter } from '../painter';
import type { Style } from '../style';

export interface GaugeModel {
  cx: number; cy: number; r: number; value: number; accent: number; track: number;
  /** SVG hooks: tag/pathLength the arcs so a DOM consumer can style + animate them. */
  trackTag?: string; valueTag?: string; valuePathLength?: number;
}

const TOP = -Math.PI / 2;

export function gauge(p: Painter, m: GaugeModel): void {
  const v = m.value < 0 ? 0 : m.value > 1 ? 1 : m.value;
  const trackSt: Style = { stroke: m.track, width: 1 };
  if (m.trackTag) trackSt.tag = m.trackTag;
  p.arc(m.cx, m.cy, m.r, TOP, TOP + 2 * Math.PI, trackSt);
  if (v > 0) {
    const st: Style = { stroke: m.accent, width: 2 };
    if (m.valueTag) st.tag = m.valueTag;
    if (m.valuePathLength !== undefined) st.pathLength = m.valuePathLength;
    p.arc(m.cx, m.cy, m.r, TOP, TOP + 2 * Math.PI * v, st);
  }
  p.text(m.cx, m.cy, `${Math.round(v * 100)}%`, { fill: m.accent, align: 'c', bold: true });
}
