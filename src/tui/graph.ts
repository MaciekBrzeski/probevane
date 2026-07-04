// Module-constellation graph — now an adapter over the shared engine's
// nodeGraph widget (@facet/core): render into a sub-surface with a CellPainter,
// then blit into the pane. The old hand-rolled orthogonal routing is gone; the
// engine draws braille-curved edges + pills (same widget the browser draws as SVG).

import { CellPainter, blit } from '@facet/render-term';
import { nodeGraph } from '@facet/core';
import { FG } from './draw.js';
import type { Screen } from './screen.js';
import type { ConstellationNode } from '../observe/constellation.js';

interface Rect { x: number; y: number; w: number; h: number }
const MAX_NODES = 8;

/** The graph needs room; below this the caller falls back to a ranked hub list. */
export function graphFits(r: Rect, nodeCount: number): boolean {
  return nodeCount >= 2 && r.w >= 34 && r.h >= 6;
}

const accentOf = (n: ConstellationNode): number =>
  n.callsNetwork ? FG.err : n.state === 'active' ? FG.acc : FG.dim;

/** Render the hubs as the engine's node graph, inset inside the pane rect `r`. */
export function renderGraph(scr: Screen, r: Rect, hubs: ConstellationNode[]): void {
  const iw = r.w - 3, ih = r.h - 2;
  if (iw < 2 || ih < 2) return;
  const p = new CellPainter(iw, ih);
  nodeGraph(p, {
    rect: { x: 0, y: 0, w: iw, h: ih },
    edge: FG.line,
    nodes: hubs.slice(0, MAX_NODES).map((n) => ({ id: n.id, label: n.label, deps: n.deps, accent: accentOf(n) })),
  });
  blit(scr, p.flush(), r.x + 2, r.y + 1);
}
