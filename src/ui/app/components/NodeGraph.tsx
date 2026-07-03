import { layoutDag, type LayoutNode } from '../layout.ts';
import { esc } from '../lib.ts';

// SVG DAG renderer for the console: nodes as glowing capsules, edges as
// curves with an animated dash-flow ("data moving through the pipe").
// Node states drive CSS classes: idle | active | ok | err.
export interface GraphNodeSpec {
  id: string;
  label: string;
  deps: string[];
  state?: 'idle' | 'active' | 'ok' | 'err';
  /** 0..1 → node emphasis (constellation: fan-in). */
  weight?: number;
  title?: string;
}

export function NodeGraph(props: { nodes: GraphNodeSpec[]; id?: string; compact?: boolean }): Node {
  const dag: LayoutNode[] = props.nodes.map((n) => ({ id: n.id, deps: n.deps }));
  const compact = props.compact === true;
  const nodeW = compact ? 88 : 110;
  const l = layoutDag(dag, compact ? { colGap: 98, rowGap: 56, pad: 24 } : {});
  const pos = new Map(l.nodes.map((n) => [n.id, n]));
  const spec = new Map(props.nodes.map((n) => [n.id, n]));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${l.width} ${l.height}`);
  svg.setAttribute('width', String(l.width));
  svg.setAttribute('height', String(l.height));
  svg.setAttribute('class', 'nodegraph');
  if (props.id) svg.id = props.id;

  const edges = l.edges
    .map(({ from, to }) => {
      const a = pos.get(from)!;
      const b = pos.get(to)!;
      const midX = (a.x + b.x) / 2 + nodeW / 2;
      return `<path class="ng-edge" data-from="${esc(from)}" data-to="${esc(to)}" d="M ${a.x + nodeW} ${a.y + 16} C ${midX} ${a.y + 16}, ${midX} ${b.y + 16}, ${b.x} ${b.y + 16}" pathLength="1"/>`;
    })
    .join('');
  const nodes = l.nodes
    .map((n) => {
      const s = spec.get(n.id)!;
      const w = Math.round(8 + (s.weight ?? 0) * 10);
      return (
        `<g class="ng-node ${s.state ?? 'idle'}" data-node="${esc(n.id)}" transform="translate(${n.x},${n.y})">` +
        `<title>${esc(s.title ?? s.label)}</title>` +
        `<rect rx="16" width="${nodeW}" height="32" stroke-width="${(s.weight ?? 0) > 0.6 ? 2.5 : 1.5}"/>` +
        `<circle class="ng-lamp" cx="${compact ? 12 : 16}" cy="16" r="${Math.min(6, w / 2)}"/>` +
        `<text x="${compact ? 24 : 30}" y="21">${esc(s.label.slice(0, compact ? 9 : 12))}</text>` +
        `</g>`
      );
    })
    .join('');
  svg.innerHTML = edges + nodes;
  return <div class="nodegraph-wrap">{svg}</div>;
}
