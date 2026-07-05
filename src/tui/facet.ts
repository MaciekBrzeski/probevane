// Bridge from the facet component library (@facet/core widgets, authored once
// against a Painter) into the TUI's cell Screen. A pane hands `paintWidget` its
// rect + a draw callback; we run the widgets on a CellPainter sized to the rect
// (local 0,0 coords), then blit the non-blank cells back into the Screen. This
// lets the terminal control center reuse the exact widgets the browser catalog
// ships — no second hand-rolled implementation.

import { CellPainter } from '@facet/render-term';
import { emptyState, type Painter } from '@facet/core';
import { blit, type Screen } from './screen.js';
import { FG } from './draw.js';

interface Box { x: number; y: number; w: number; h: number }

/** Draw facet widgets into `r` (rect-local coords) and overlay them onto `scr`. */
export function paintWidget(scr: Screen, r: Box, draw: (p: Painter) => void): void {
  if (r.w < 1 || r.h < 1) return;
  const p = new CellPainter(r.w, r.h);
  draw(p);
  blit(scr, p.flush(), r.x, r.y);
}

/** A centred facet emptyState filling a pane (the shared "nothing here" placeholder). */
export function emptyPane(scr: Screen, r: Box, icon: string, title: string, hint?: string): void {
  paintWidget(scr, r, (p) => {
    emptyState(p, { rect: { x: 0, y: 0, w: r.w, h: r.h }, icon, title, hint, accent: FG.acc, dim: FG.dim });
  });
}
