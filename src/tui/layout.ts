// Deterministic layered DAG layout — no physics, no dependencies, same input →
// same picture. Longest-path layering (roots left), then barycenter-ish
// ordering within a layer (parents' mean row), finally positions on a fixed
// grid. Pure + unit-tested. Shared: the browser SVG pipeline graph
// (ui/app/components/NodeGraph.tsx) and the terminal ANSI pipeline both use it.

export interface LayoutNode {
  id: string;
  /** Edges point dep → dependent (data flows left to right). */
  deps: string[];
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  layer: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
}

export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

// Longest path from any root — iterate to fixpoint (cycles clamp at |V| passes).
function computeLayers(input: LayoutNode[], ids: Set<string>): Map<string, number> {
  const layer = new Map<string, number>();
  for (const n of input) layer.set(n.id, 0);
  for (let pass = 0; pass < input.length; pass++) {
    let changed = false;
    for (const n of input) {
      for (const d of n.deps) {
        if (!ids.has(d)) continue;
        const want = (layer.get(d) ?? 0) + 1;
        if (want > (layer.get(n.id) ?? 0) && want < input.length) {
          layer.set(n.id, want);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return layer;
}

// Order within a layer by mean parent row (stable fallback: insertion order).
function computeRows(input: LayoutNode[], layer: Map<string, number>): Map<string, number> {
  const byLayer = new Map<number, string[]>();
  for (const n of input) {
    const l = layer.get(n.id)!;
    (byLayer.get(l) ?? byLayer.set(l, []).get(l)!).push(n.id);
  }
  const row = new Map<string, number>();
  for (const l of [...byLayer.keys()].sort((a, b) => a - b)) {
    const parentRow = (id: string) => {
      const deps = input.find((n) => n.id === id)!.deps.filter((d) => row.has(d));
      return deps.length ? deps.reduce((s, d) => s + row.get(d)!, 0) / deps.length : Number.MAX_SAFE_INTEGER;
    };
    byLayer.get(l)!
      .map((id, i) => ({ id, key: parentRow(id), i }))
      .sort((a, b) => a.key - b.key || a.i - b.i)
      .forEach(({ id }, r) => row.set(id, r));
  }
  return row;
}

export function layoutDag(
  input: LayoutNode[],
  opts: { colGap?: number; rowGap?: number; pad?: number } = {},
): Layout {
  const colGap = opts.colGap ?? 170;
  const rowGap = opts.rowGap ?? 64;
  const pad = opts.pad ?? 40;
  const ids = new Set(input.map((n) => n.id));
  const layer = computeLayers(input, ids);
  const row = computeRows(input, layer);

  const nodes: PlacedNode[] = input.map((n) => ({
    id: n.id,
    layer: layer.get(n.id)!,
    x: pad + layer.get(n.id)! * colGap,
    y: pad + row.get(n.id)! * rowGap,
  }));
  const edges: PlacedEdge[] = input.flatMap((n) =>
    n.deps.filter((d) => ids.has(d)).map((d) => ({ from: d, to: n.id })),
  );
  const width = pad * 2 + Math.max(0, ...nodes.map((n) => n.x)) + 130;
  const height = pad + Math.max(0, ...nodes.map((n) => n.y)) + rowGap;
  return { nodes, edges, width, height };
}

/** A straight chain (the rune pipeline) is just a degenerate DAG. */
export function chainToDag(ids: string[]): LayoutNode[] {
  return ids.map((id, i) => ({ id, deps: i ? [ids[i - 1]] : [] }));
}
