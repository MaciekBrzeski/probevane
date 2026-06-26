import type { ModuleGraph } from '../mock/graph.js';

// Test-impact analysis — given a diff, run ONLY the tests affected by it. A spec
// is impacted if it (transitively) imports a changed source file. Speeds CI: skip
// the tests a change can't break. Pure core; the CLI wires git + the module graph.

/** Does any of `starts` transitively reach a file in `targets` via graph imports? */
export function reachesAny(graph: ModuleGraph, starts: string[], targets: Set<string>): boolean {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    if (targets.has(p)) return true;
    for (const dep of graph.nodes.get(p)?.imports ?? []) stack.push(dep);
  }
  return false;
}

/**
 * Spec files impacted by `changed`: the spec itself changed, OR a source file it
 * imports (directly or transitively) changed. `specDeps` maps a spec's rel path to
 * its direct local source imports (graph node keys).
 */
export function impactedSpecs(graph: ModuleGraph, specDeps: Map<string, string[]>, changed: string[]): string[] {
  const changedSet = new Set(changed);
  const out: string[] = [];
  for (const [spec, deps] of specDeps) {
    if (changedSet.has(spec) || deps.some((d) => changedSet.has(d)) || reachesAny(graph, deps, changedSet)) {
      out.push(spec);
    }
  }
  return out;
}
