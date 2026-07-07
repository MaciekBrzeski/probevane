// Module-constellation graph for the terminal — pre-calculated ORTHOGONAL edge
// routing (clean box-drawing L-paths + ┼ junctions), which reads far better in
// cells than a braille-rasterized diagonal. Positions come from the shared
// layoutDag (@facet/core, via ./layout); the browser draws the same data with
// its own SVG NodeGraph, and facet's nodeGraph widget serves the gallery.

import { putText } from './screen.js';
import { pulse, glow, mix } from './anim.js';
import { layoutDag, type LayoutNode, type Layout } from './layout.js';
import { trunc, FG } from './draw.js';
import type { Screen, Style } from './screen.js';
import type { ConstellationNode } from '../observe/constellation.js';

interface Rect { x: number; y: number; w: number; h: number }
interface Anchor { lx: number; rx: number; cy: number; layer: number }
const WIRE = '─│┌┐└┘┼├┤┬┴';

/** The graph needs room; below this the caller falls back to a ranked hub list. */
export function graphFits(r: Rect, nodeCount: number): boolean {
  return nodeCount >= 2 && r.w >= 34 && r.h >= 6;
}

const accentOf = (n: ConstellationNode): number =>
  n.callsNetwork ? FG.err : n.state === 'active' ? FG.acc : FG.dim;
const pill = (n: ConstellationNode, w: number): string => `( ${trunc(n.label, w)} )`;

/**
 * Select the connected clusters to show. Top-fan-in hubs are sinks (few edges
 * among them), so a plain top-N slice is mostly isolated leaves. Instead: find
 * the connected components (undirected), drop singletons, and greedily add whole
 * components largest-first up to `budget` — filling the pane with real clusters,
 * never a lone pill.
 */
/** Undirected adjacency map over the hub set; deps pointing outside the set are ignored. */
function hubAdjacency(hubs: ConstellationNode[]): Map<string, Set<string>> {
  const ids = new Set(hubs.map((h) => h.id));
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); };
  for (const h of hubs) for (const d of h.deps) if (ids.has(d)) { link(h.id, d); link(d, h.id); }
  return adj;
}

/** BFS from `start` over `adj`, marking `seen`; returns the reached component (incl. start). */
function reachFrom(start: string, adj: Map<string, Set<string>>, seen: Set<string>): string[] {
  const comp: string[] = [];
  const q = [start];
  seen.add(start);
  while (q.length) {
    const x = q.pop()!;
    comp.push(x);
    for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); }
  }
  return comp;
}

/** Undirected connected components of the hub graph with ≥2 nodes, largest first. */
function components(hubs: ConstellationNode[]): string[][] {
  const adj = hubAdjacency(hubs);
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const h of hubs) {
    if (seen.has(h.id)) continue;
    const comp = reachFrom(h.id, adj, seen);
    if (comp.length >= 2) comps.push(comp);
  }
  return comps.sort((a, b) => b.length - a.length);
}

function connectedCore(hubs: ConstellationNode[], budget: number): ConstellationNode[] {
  const keep = new Set<string>();
  for (const c of components(hubs)) { if (keep.size + c.length > budget) continue; for (const id of c) keep.add(id); }
  const chosen = hubs.filter((h) => keep.has(h.id));
  return chosen.map((h) => ({ ...h, deps: h.deps.filter((d) => keep.has(d)) }));
}

/** Draw a wire glyph; where two different wires meet, merge to ┼ (never a false turn). */
function wire(scr: Screen, x: number, y: number, g: string, st: Style): void {
  const cur = scr.cells[y * scr.w + x]?.ch;
  putText(scr, x, y, cur && cur !== g && WIRE.includes(cur) ? '┼' : g, st);
}

// Box-drawing glyph for a junction given its arms (bits: up=1 down=2 left=4 right=8).
const JUNCTION: Record<number, string> = {
  3: '│', 12: '─', 11: '├', 7: '┤', 14: '┬', 13: '┴', 15: '┼', 10: '┌', 6: '┐', 9: '└', 5: '┘',
};

/**
 * Route ALL of the focused node's edges as ONE spine-and-branch tree: a single
 * vertical spine beside the node, with a clean ├ branch to each neighbour on its
 * own row. No per-edge channels → no crossing grid, just smooth pipes.
 */
function bundle(scr: Screen, f: Anchor, neighbors: Anchor[], toRight: boolean, st: Style): void {
  const spineX = toRight ? f.rx + 2 : f.lx - 2;
  const hseg = (y: number, x0: number, x1: number): void => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) wire(scr, x, y, '─', st);
  };
  const rowsLeft = new Set<number>(), rowsRight = new Set<number>();
  (toRight ? rowsLeft : rowsRight).add(f.cy); // the branch back to the focused node
  for (const o of neighbors) (toRight ? rowsRight : rowsLeft).add(o.cy);
  const rows = [f.cy, ...neighbors.map((o) => o.cy)];
  const top = Math.min(...rows), bot = Math.max(...rows);
  for (let y = top; y <= bot; y++) {
    let arm = 0;
    if (y > top) arm |= 1;
    if (y < bot) arm |= 2;
    if (rowsLeft.has(y)) arm |= 4;
    if (rowsRight.has(y)) arm |= 8;
    putText(scr, spineX, y, JUNCTION[arm] ?? '│', st);
  }
  if (toRight) hseg(f.cy, f.rx + 1, spineX - 1); else hseg(f.cy, spineX + 1, f.lx - 1);
  for (const o of neighbors) { if (toRight) hseg(o.cy, spineX + 1, o.lx - 1); else hseg(o.cy, o.rx + 1, spineX - 1); }
}

interface Placed {
  lay: Layout;
  anchor: Map<string, Anchor>;
  byId: Map<string, ConstellationNode>;
  nodeW: number;
}

/** Lay the nodes out into cell anchors + the channel gap. */
function placeGraph(nodes: ConstellationNode[], r: Rect, iw: number, ih: number): Placed {
  const lay = layoutDag(nodes.map((n): LayoutNode => ({ id: n.id, deps: n.deps })), { colGap: 1, rowGap: 1, pad: 0 });
  const maxC = Math.max(0, ...lay.nodes.map((n) => n.x));
  const maxR = Math.max(0, ...lay.nodes.map((n) => n.y));
  const nodeW = Math.max(6, Math.min(16, Math.floor(iw / (maxC + 1)) - 2));
  const colStep = maxC > 0 ? Math.floor((iw - nodeW) / maxC) : 0;
  const rowStep = maxR > 0 ? Math.min(2, Math.max(1, Math.floor((ih - 1) / maxR))) : 1;
  const x0 = r.x + 2, y0 = r.y + 1;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const anchor = new Map<string, Anchor>();
  for (const n of lay.nodes) {
    const px = x0 + n.x * colStep, py = y0 + n.y * rowStep;
    const len = [...pill(byId.get(n.id)!, nodeW - 4)].length;
    anchor.set(n.id, { lx: px, rx: px + len - 1, cy: py, layer: n.x });
  }
  return { lay, anchor, byId, nodeW };
}

/** Pill colour: the focused node pulses bright (its own state hue), its neighbours pop, the rest fade back. */
function pillStyle(nn: ConstellationNode, isFocus: boolean, isNbr: boolean, t: number): Style {
  if (isFocus) return { fg: glow(accentOf(nn), pulse(t, 900)), bold: true };
  if (isNbr) return { fg: accentOf(nn), bold: true };
  return { fg: mix(accentOf(nn), FG.bg, 0.55) };
}

interface Edge { from: string; to: string; a: Anchor; b: Anchor }

/** Edges with both endpoints anchored and on-screen, sorted for stable spine routing. */
function visibleEdges(lay: Layout, anchor: Map<string, Anchor>, bottom: number): Edge[] {
  return lay.edges
    .map((e) => ({ from: e.from, to: e.to, a: anchor.get(e.from), b: anchor.get(e.to) }))
    .filter((e): e is Edge => !!e.a && !!e.b && e.a.cy < bottom && e.b.cy < bottom)
    .sort((p, q) => p.b.cy - q.b.cy || p.a.cy - q.a.cy);
}

/** Ids of nodes on an edge that touches the focused node (both endpoints highlight). */
function neighborIds(edges: Edge[], focusId: string): Set<string> {
  const nbr = new Set<string>();
  for (const e of edges) if (e.from === focusId || e.to === focusId) { nbr.add(e.from); nbr.add(e.to); }
  return nbr;
}

/** Draw every on-screen node's pill, styled by focus / neighbour / faded-back. */
function drawPills(scr: Screen, placed: Placed, focusId: string, nbr: Set<string>, bottom: number, t: number): void {
  const { lay, anchor, byId, nodeW } = placed;
  for (const n of lay.nodes) {
    const a = anchor.get(n.id)!;
    if (a.cy >= bottom) continue;
    const nn = byId.get(n.id)!;
    putText(scr, a.lx, a.cy, pill(nn, nodeW - 4), pillStyle(nn, n.id === focusId, nbr.has(n.id), t));
  }
}

/**
 * Focus-mode node graph: all nodes drawn, but only the FOCUSED node's edges light
 * up (the rest fade to a faint mesh) — the readable way to show a dense graph in
 * cells. `focus` indexes the shown nodes; the driver cycles it with ↑↓.
 */
export function renderGraph(scr: Screen, r: Rect, hubs: ConstellationNode[], t = 0, focus = 0): void {
  const iw = r.w - 3, ih = r.h - 2;
  if (iw < 2 || ih < 2) return;
  const nodes = connectedCore(hubs, Math.min(24, Math.max(6, ih))); // ~2 rows/node, cap 24
  if (!nodes.length) return;
  const placed = placeGraph(nodes, r, iw, ih);
  const { lay, anchor } = placed;
  const bottom = r.y + r.h - 1;
  const focusId = nodes[((focus % nodes.length) + nodes.length) % nodes.length]!.id;

  const edges = visibleEdges(lay, anchor, bottom);
  const nbr = neighborIds(edges, focusId);
  const focused = (e: { from: string; to: string }): boolean => e.from === focusId || e.to === focusId;

  // Only the focused node's edges are drawn — as ONE clean spine tree. No mesh of
  // other edges → no crossings; ↑↓ walks the graph one node at a time.
  const brightSt: Style = { fg: glow(FG.acc, pulse(t, 1200)) }; // focused pipes gently pulse
  const f = anchor.get(focusId);
  const neighborAnchors = edges.filter(focused).map((e) => (e.from === focusId ? e.b : e.a));
  if (f && neighborAnchors.length) bundle(scr, f, neighborAnchors, f.layer === 0, brightSt);
  drawPills(scr, placed, focusId, nbr, bottom, t);
}
