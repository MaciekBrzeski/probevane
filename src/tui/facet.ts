// Bridge from the facet component library (@facet/core widgets, authored once
// against a Painter) into the TUI's cell Screen. A pane hands `paintWidget` its
// rect + a draw callback; we run the widgets on a CellPainter sized to the rect
// (local 0,0 coords), then blit the non-blank cells back into the Screen. This
// lets the terminal control center reuse the exact widgets the browser catalog
// ships — no second hand-rolled implementation.

import { CellPainter } from '@facet/render-term';
import { blit, type Screen } from './screen.js';
import type { Painter } from '@facet/core';

interface Box { x: number; y: number; w: number; h: number }

/** Draw facet widgets into `r` (rect-local coords) and overlay them onto `scr`. */
export function paintWidget(scr: Screen, r: Box, draw: (p: Painter) => void): void {
  if (r.w < 1 || r.h < 1) return;
  const p = new CellPainter(r.w, r.h);
  draw(p);
  blit(scr, p.flush(), r.x, r.y);
}
