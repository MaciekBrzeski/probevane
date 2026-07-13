// Shared selection for the "module constellation" — picks the top fan-in hubs
// and drops anything with no edge INSIDE the kept set (a constellation is about
// connections; isolated nodes are noise). SSOT consumed by BOTH the browser
// console (rendered as an SVG NodeGraph) and the terminal console (rendered as
// a ranked hub list). One filtering rule, two renderers.

export interface GraphNode { path: string; imports: string[]; fanIn: number; callsNetwork: boolean }
/** One rendered constellation node — built by constellation() from a GraphNode;
 *  weight/state drive the lamp styling in both renderers. */
export interface ConstellationNode {
  id: string; label: string; title: string; deps: string[];
  weight: number; callsNetwork: boolean; state: 'idle' | 'active' | 'err';
}

const POOL = 40, MAX = 24;
const basename = (p: string): string => p.split('/').pop()!.replace(/\.[tj]sx?$/, '');

/** Select the top fan-in hubs, drop nodes with no edge inside the kept set, and
 *  grade each by relative fan-in — the one filtering rule both renderers share. */
export function constellation(nodes: GraphNode[]): ConstellationNode[] {
  const pool = [...nodes].sort((a, b) => b.fanIn - a.fanIn).slice(0, POOL);
  const poolIds = new Set(pool.map((n) => n.path));
  const linked = new Set<string>();
  for (const n of pool) for (const d of n.imports) if (poolIds.has(d)) { linked.add(n.path); linked.add(d); }
  const top = pool.filter((n) => linked.has(n.path)).slice(0, MAX);
  const keep = new Set(top.map((n) => n.path));
  const maxFan = Math.max(1, ...top.map((n) => n.fanIn));
  return top.map((n) => {
    const weight = n.fanIn / maxFan;
    return {
      id: n.path, label: basename(n.path), title: `${n.path} · fan-in ${n.fanIn}`,
      deps: n.imports.filter((d) => keep.has(d)), weight, callsNetwork: n.callsNetwork,
      state: n.callsNetwork ? 'err' : weight > 0.5 ? 'active' : 'idle',
    };
  });
}
