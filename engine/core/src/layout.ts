// Deterministic layered-DAG layout — no physics, no deps, same input → same
// picture. Longest-path layering (roots left), barycenter-ish ordering within a
// layer (parents' mean row), positions on a fixed grid. Pure + unit-tested; both
// backends draw from it (SVG bézier edges / cell orthogonal+braille edges).

export interface LayoutNode {
  id: string;
  /** Edges point dep → dependent (data flows left to right). */
  deps: string[];
}

export interface PlacedNode { id: string; x: number; y: number; layer: number }
export interface PlacedEdge { from: string; to: string }
export interface Layout { nodes: PlacedNode[]; edges: PlacedEdge[]; width: number; height: number }

// Longest path from any root — iterate to a fixpoint (cycles clamp at |V| passes).
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
    const l = layer.get(n.id) ?? 0;
    const bucket = byLayer.get(l) ?? [];
    bucket.push(n.id);
    byLayer.set(l, bucket);
  }
  const row = new Map<string, number>();
  for (const l of [...byLayer.keys()].sort((a, b) => a - b)) {
    const parentRow = (id: string): number => {
      const node = input.find((n) => n.id === id);
      const deps = (node?.deps ?? []).filter((d) => row.has(d));
      return deps.length ? deps.reduce((s, d) => s + (row.get(d) ?? 0), 0) / deps.length : Number.MAX_SAFE_INTEGER;
    };
    (byLayer.get(l) ?? [])
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
    layer: layer.get(n.id) ?? 0,
    x: pad + (layer.get(n.id) ?? 0) * colGap,
    y: pad + (row.get(n.id) ?? 0) * rowGap,
  }));
  const edges: PlacedEdge[] = input.flatMap((n) =>
    n.deps.filter((d) => ids.has(d)).map((d) => ({ from: d, to: n.id })),
  );
  const width = pad * 2 + Math.max(0, ...nodes.map((n) => n.x)) + 130;
  const height = pad + Math.max(0, ...nodes.map((n) => n.y)) + rowGap;
  return { nodes, edges, width, height };
}

/** A straight chain (e.g. the rune pipeline) is a degenerate DAG. */
export function chainToDag(ids: string[]): LayoutNode[] {
  return ids.map((id, i) => ({ id, deps: i ? [ids[i - 1] as string] : [] }));
}
