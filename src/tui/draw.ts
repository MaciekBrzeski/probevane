// Higher-level draw primitives for the TUI — pure string/number helpers on top
// of the screen runtime. Colors mirror the web control center's palette.

import type { Style } from './screen.js';
import { PALETTE, packed, type ColorName } from '../util/theme.js';

// Palette — packed 24-bit 0xRRGGBB derived from the shared theme SSOT
// (src/ui/theme.ts), the SAME hexes the browser :root uses. screen.ts sgr()
// emits truecolor, 256-color fallback on plain terminals. One edit in theme.ts
// repaints both renderers.
export const FG = Object.fromEntries(
  (Object.keys(PALETTE) as ColorName[]).map((k) => [k, packed(k)]),
) as Record<ColorName, number>;

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Unicode-block sparkline of `values`, right-trimmed to `width` (newest at right). */
export function sparkline(values: number[], width: number): string {
  if (!values.length || width <= 0) return '';
  const slice = values.slice(-width);
  const max = Math.max(...slice);
  if (max <= 0) return '▁'.repeat(slice.length);
  return slice.map((v) => BLOCKS[Math.min(7, Math.max(0, Math.round((v / max) * 7)))]).join('');
}

/** Pad `s` to `n` (right-pad by default); truncates with … when longer. */
export function pad(s: string, n: number, align: 'l' | 'r' = 'l'): string {
  const chars = [...s];
  if (chars.length > n) return n <= 1 ? chars.slice(0, n).join('') : chars.slice(0, n - 1).join('') + '…';
  const fill = ' '.repeat(n - chars.length);
  return align === 'r' ? fill + s : s + fill;
}

/** Truncate to `n` chars with an ellipsis. */
export function trunc(s: string, n: number): string {
  const chars = [...s];
  return chars.length <= n ? s : (n <= 1 ? chars.slice(0, n).join('') : chars.slice(0, n - 1).join('') + '…');
}

/** Style for a run/job status word (mirrors the web .tag colors). */
export function statusStyle(status: string): Style {
  if (/^(running|accepted)$/.test(status)) return { fg: FG.acc, bold: true };
  if (/^(done|ok)$/.test(status)) return { fg: FG.ok, bold: true };
  if (/^(error|stuck|max_steps|difficulty|budget)$/.test(status)) return { fg: FG.err, bold: true };
  if (status === 'cancelled') return { fg: FG.warn, bold: true };
  return { fg: FG.dim };
}

/** Lamp glyph + style for a pipeline rune state. */
export function lamp(state: 'idle' | 'active' | 'ok' | 'err'): { ch: string; st: Style } {
  switch (state) {
    case 'active': return { ch: '◉', st: { fg: FG.acc, bold: true } };
    case 'ok': return { ch: '●', st: { fg: FG.ok, bold: true } };
    case 'err': return { ch: '✖', st: { fg: FG.err, bold: true } };
    default: return { ch: '○', st: { fg: FG.dim } };
  }
}
