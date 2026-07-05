// Layered-DAG node graph — layoutDag places nodes; edges are polylines (SVG
// straight/curve, cell axis+braille); nodes are pills. The one caps branch:
// on a glyph grid a node is a 1-row `( label )` text pill (a small box can't hold
// text); on a pixel canvas it's a stroked rect + centred label.

import type { Painter, Pt } from '../painter';
import type { Rect } from '../geom';
import { layoutDag } from '../layout';

export interface GraphNodeModel { id: string; label: string; deps: string[]; accent: number }
export interface GraphModel { rect: Rect; nodes: GraphNodeModel[]; edge: number; nodeW?: number }

const cut = (s: string, n: number): string =>
  [...s].length <= n ? s : [...s].slice(0, Math.max(0, n - 1)).join('') + '…';

export function nodeGraph(p: Painter, m: GraphModel): void {
  const lay = layoutDag(m.nodes.map((n) => ({ id: n.id, deps: n.deps })), { colGap: 1, rowGap: 1, pad: 0 });
  const maxC = Math.max(0, ...lay.nodes.map((n) => n.x));
  const maxR = Math.max(0, ...lay.nodes.map((n) => n.y));
  const { x, y, w, h } = m.rect;
  const nodeW = m.nodeW ?? Math.min(14, Math.max(6, w / (maxC + 1) - 2));
  const colStep = maxC > 0 ? (w - nodeW) / maxC : 0;
  const rowStep = h / (maxR + 1);
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const pos = new Map<string, Pt>(lay.nodes.map((n) => [n.id, { x: x + n.x * colStep, y: y + n.y * rowStep + rowStep / 2 }]));

  for (const e of lay.edges) { // edges behind
    const a = pos.get(e.from), b = pos.get(e.to);
    if (a && b) p.line(a.x + nodeW, a.y, b.x, b.y, { stroke: m.edge });
  }
  for (const n of lay.nodes) { // nodes on top
    const P = pos.get(n.id)!, nn = byId.get(n.id)!;
    if (p.caps.glyphGrid) {
      p.text(P.x, P.y, `( ${cut(nn.label, nodeW - 4)} )`, { fill: nn.accent, bold: true });
    } else {
      p.rect(P.x, P.y - rowStep * 0.35, nodeW, rowStep * 0.7, { stroke: nn.accent });
      p.text(P.x + nodeW / 2, P.y, cut(nn.label, nodeW - 2), { fill: nn.accent, align: 'c' });
    }
  }
}
