// LCARS chrome for the TUI — the terminal analog of the browser console's
// ScanFrame (src/ui/app/components/ScanFrame.tsx / .scanframe in control.css).
// Pure: paints into a Screen, no I/O. Terminal physics can't do the browser's
// glow/gradient/sub-cell radius, but the identity carries: rounded corners, a
// thick accent left-rail, an elbow nub, and a letter-spaced uppercase title.

import { box, putText, fillRect, type Screen, type Style } from './screen.js';
import { FG } from './draw.js';

/** 'RUNS' → 'R U N S' — the .sf-title letter-spacing, in cells. */
export function spaced(title: string): string {
  return [...title.toUpperCase()].join(' ');
}

/**
 * Draw an LCARS panel frame filling `rect`, titled, in `accent`.
 * Border in the dim --line colour; left column overpainted as a solid accent
 * rail (▉) with an elbow nub at the top; title letter-spaced + bold just past
 * the elbow. Content should be painted inset at rect.x+2 (clears the rail).
 */
export function lcarsFrame(
  scr: Screen, r: { x: number; y: number; w: number; h: number }, title: string, accent: number,
): void {
  if (r.w < 2 || r.h < 2) return;
  const acc: Style = { fg: accent, bold: true };
  fillRect(scr, r.x, r.y, r.w, r.h, FG.panel); // solid panel card (content inherits this bg)
  box(scr, r.x, r.y, r.w, r.h, '', { fg: FG.line }); // borders in --line, title drawn below
  for (let row = r.y + 1; row < r.y + r.h - 1; row++) putText(scr, r.x, row, '▉', acc); // accent left-rail
  putText(scr, r.x, r.y, '╭', acc);          // rounded top-left in accent
  putText(scr, r.x, r.y + r.h - 1, '╰', acc); // rounded bottom-left in accent
  putText(scr, r.x + 1, r.y, '▬', acc);       // elbow nub
  if (title) putText(scr, r.x + 3, r.y, ' ' + spaced(title) + ' ', acc);
}
