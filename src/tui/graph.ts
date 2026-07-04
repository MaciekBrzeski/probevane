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

/**
 * Show the LARGEST connected component of the hub graph (up to `n` nodes, by
 * weight). Top-fan-in hubs are sinks (imported everywhere, import little), so a
 * plain top-N slice is mostly isolated leaves + one stray edge. Restricting to a
 * connected component guarantees every shown node actually links to another.
 */
function connectedCore(hubs: ConstellationNode[], n: number): ConstellationNode[] {
  const ids = new Set(hubs.map((h) => h.id));
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); };
  for (const h of hubs) for (const d of h.deps) if (ids.has(d)) { link(h.id, d); link(d, h.id); }

  const seen = new Set<string>();
  let best: string[] = [];
  for (const h of hubs) {
    if (seen.has(h.id)) continue;
    const comp: string[] = [];
    const q = [h.id];
    seen.add(h.id);
    while (q.length) {
      const x = q.pop()!;
      comp.push(x);
      for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); }
    }
    if (comp.length > best.length) best = comp;
  }
  const inBest = new Set(best);
  const chosen = hubs.filter((h) => inBest.has(h.id)).slice(0, n); // hubs are weight-sorted
  const kept = new Set(chosen.map((h) => h.id));
  return chosen.map((h) => ({ ...h, deps: h.deps.filter((d) => kept.has(d)) }));
}

/** Render the hubs as the engine's node graph, inset inside the pane rect `r`. */
export function renderGraph(scr: Screen, r: Rect, hubs: ConstellationNode[]): void {
  const iw = r.w - 3, ih = r.h - 2;
  if (iw < 2 || ih < 2) return;
  const p = new CellPainter(iw, ih);
  nodeGraph(p, {
    rect: { x: 0, y: 0, w: iw, h: ih },
    edge: FG.line,
    nodes: connectedCore(hubs, MAX_NODES).map((n) => ({ id: n.id, label: n.label, deps: n.deps, accent: accentOf(n) })),
  });
  blit(scr, p.flush(), r.x + 2, r.y + 1);
}
