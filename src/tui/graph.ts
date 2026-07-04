// Module-constellation graph for the terminal — pre-calculated ORTHOGONAL edge
// routing (clean box-drawing L-paths + ┼ junctions), which reads far better in
// cells than a braille-rasterized diagonal. Positions come from the shared
// layoutDag (@facet/core, via ./layout); the browser draws the same data with
// its own SVG NodeGraph, and facet's nodeGraph widget serves the gallery.

import { putText } from './screen.js';
import { pulse, glow, mix } from './anim.js';
import { layoutDag, type LayoutNode } from './layout.js';
import { trunc, FG } from './draw.js';
import type { Screen, Style } from './screen.js';
import type { ConstellationNode } from '../observe/constellation.js';

interface Rect { x: number; y: number; w: number; h: number }
interface Anchor { lx: number; rx: number; cy: number; layer: number }
type Pt = { x: number; y: number };
const MAX_NODES = 8;
const WIRE = '─│┌┐└┘┼';

/** The graph needs room; below this the caller falls back to a ranked hub list. */
export function graphFits(r: Rect, nodeCount: number): boolean {
  return nodeCount >= 2 && r.w >= 34 && r.h >= 6;
}

const accentOf = (n: ConstellationNode): number =>
  n.callsNetwork ? FG.err : n.state === 'active' ? FG.acc : FG.dim;
const pill = (n: ConstellationNode, w: number): string => `( ${trunc(n.label, w)} )`;

/**
 * Show the LARGEST connected component of the hub graph (up to `n`, weight-sorted).
 * Top-fan-in hubs are sinks (few edges among them), so a plain top-N slice is
 * mostly isolated leaves; a connected component guarantees every node links.
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
  const chosen = hubs.filter((h) => inBest.has(h.id)).slice(0, n);
  const kept = new Set(chosen.map((h) => h.id));
  return chosen.map((h) => ({ ...h, deps: h.deps.filter((d) => kept.has(d)) }));
}

/** Draw a wire glyph; where two different wires meet, merge to ┼ (never a false turn). */
function wire(scr: Screen, x: number, y: number, g: string, st: Style): void {
  const cur = scr.cells[y * scr.w + x]?.ch;
  putText(scr, x, y, cur && cur !== g && WIRE.includes(cur) ? '┼' : g, st);
}

/** Route one edge a→b through vertical channel `chX`; returns the path cells (for the signal dot). */
function routeEdge(scr: Screen, a: Anchor, b: Anchor, chX: number, st: Style): Pt[] {
  const path: Pt[] = [];
  const hseg = (y: number, x0: number, x1: number): void => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { wire(scr, x, y, '─', st); path.push({ x, y }); }
  };
  const down = b.cy > a.cy;
  hseg(a.cy, a.rx + 1, chX - 1);
  wire(scr, chX, a.cy, a.cy === b.cy ? '─' : down ? '┐' : '┘', st); path.push({ x: chX, y: a.cy });
  for (let y = Math.min(a.cy, b.cy) + 1; y < Math.max(a.cy, b.cy); y++) { wire(scr, chX, y, '│', st); path.push({ x: chX, y }); }
  if (a.cy !== b.cy) { wire(scr, chX, b.cy, down ? '└' : '┌', st); path.push({ x: chX, y: b.cy }); }
  hseg(b.cy, chX + 1, b.lx - 1);
  return path;
}

/** Render the connected hub core as an orthogonally-routed node graph, inside pane `r`. */
export function renderGraph(scr: Screen, r: Rect, hubs: ConstellationNode[], t = 0): void {
  const iw = r.w - 3, ih = r.h - 2;
  if (iw < 2 || ih < 2) return;
  const nodes = connectedCore(hubs, MAX_NODES);
  const lay = layoutDag(nodes.map((n): LayoutNode => ({ id: n.id, deps: n.deps })), { colGap: 1, rowGap: 1, pad: 0 });
  const maxC = Math.max(0, ...lay.nodes.map((n) => n.x));
  const maxR = Math.max(0, ...lay.nodes.map((n) => n.y));
  const x0 = r.x + 2, y0 = r.y + 1;
  const nodeW = Math.max(6, Math.min(16, Math.floor(iw / (maxC + 1)) - 2));
  const colStep = maxC > 0 ? Math.floor((iw - nodeW) / maxC) : 0;
  const rowStep = maxR > 0 ? Math.max(1, Math.floor((ih - 1) / maxR)) : 1;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const anchor = new Map<string, Anchor>();
  for (const n of lay.nodes) {
    const px = x0 + n.x * colStep, py = y0 + n.y * rowStep;
    const len = [...pill(byId.get(n.id)!, nodeW - 4)].length;
    anchor.set(n.id, { lx: px, rx: px + len - 1, cy: py, layer: n.x });
  }
  const cols = [...anchor.values()];
  const leftRx = Math.max(r.x, ...cols.filter((a) => a.layer === 0).map((a) => a.rx));
  const rightLx = Math.min(r.x + r.w, ...cols.filter((a) => a.layer > 0).map((a) => a.lx));
  const wireSt: Style = { fg: mix(FG.acc, FG.line, 0.5) };
  const bottom = r.y + r.h - 1;
  lay.edges.forEach((e, i) => {
    const a = anchor.get(e.from), b = anchor.get(e.to);
    if (!a || !b || a.cy >= bottom || b.cy >= bottom) return;
    const chX = Math.min(rightLx - 2, leftRx + 2 + i); // each edge its own channel column
    const path = routeEdge(scr, a, b, chX, wireSt);
    if (path.length) {
      const dot = path[Math.floor(t / 130 + i * 4) % path.length]!;
      putText(scr, dot.x, dot.y, '•', { fg: glow(FG.acc, pulse(t, 700)), bold: true });
    }
  });
  for (const n of lay.nodes) {
    const a = anchor.get(n.id)!;
    if (a.cy >= bottom) continue;
    const nn = byId.get(n.id)!;
    const st: Style = { fg: accentOf(nn) };
    if (nn.state !== 'idle') st.bold = true; // active/err pop; idle stays dim
    putText(scr, a.lx, a.cy, pill(nn, nodeW - 4), st);
  }
}
