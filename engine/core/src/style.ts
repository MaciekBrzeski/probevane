// Packed 0xRRGGBB colour + immediate-mode draw style. Device-neutral: the SAME
// Style feeds the SVG painter (→ #rrggbb) and the cell painter (→ 38;2;r;g;b SGR),
// so a widget's colour stays in sync across both media by construction.

export type Color = number; // 0xRRGGBB

export interface Style {
  fill?: Color;
  stroke?: Color;
  width?: number; // stroke width, world units (cells round it; SVG keeps it)
  dash?: number; // dash period in world units; 0/undefined = solid
  bold?: boolean;
  align?: 'l' | 'c' | 'r'; // text horizontal anchor (default 'l')
  // --- SVG-backend hints (the cell backend ignores these) — let a DOM consumer
  //     keep its CSS animation / gradients / interactivity when it adopts a widget.
  tag?: string; // → class="tag" on the element (CSS hook, e.g. a self-drawing stroke)
  pathLength?: number; // → SVG pathLength (normalises dash-based draw-in animations)
  gradient?: boolean; // → fill with a vertical gradient of `fill` (areas)
  data?: Record<string, string | number>; // → data-* attributes (delegated interaction)
}

const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k);
const chan = (c: Color, shift: number): number => (c >> shift) & 255;

/** Split a packed colour into [r,g,b]. */
export const rgb = (c: Color): [number, number, number] => [chan(c, 16), chan(c, 8), chan(c, 0)];
/** `#rrggbb` for the SVG backend. */
export const hex = (c: Color): string => '#' + (c & 0xffffff).toString(16).padStart(6, '0');

/** Linear-interpolate two packed colours by k (0..1). */
export function mix(a: Color, b: Color, k: number): Color {
  const kk = clamp01(k);
  const lerp = (s: number): number => Math.round(chan(a, s) + (chan(b, s) - chan(a, s)) * kk) & 255;
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}

/** Brighten toward white by k — the "glow" cue (bold + bright in cells). */
export const glow = (c: Color, k: number): Color => mix(c, 0xffffff, clamp01(k) * 0.6);

/** Cosine breathing pulse: 0→1→0 over `period` (same units as `t`). */
export function pulse(t: number, period: number): number {
  const p = period <= 0 ? 1 : period;
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * (((t % p) + p) % p)) / p);
}
