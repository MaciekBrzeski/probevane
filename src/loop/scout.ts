import type { ModuleGraph } from '../mock/graph.js';

// Repo-map "scout" (Cluster 1). Pure: given the module graph + a focus path,
// produce a compact map of the target's neighborhood (what it imports + who
// imports it) to inject into a refactor/feature task. The research consensus
// (Aider repo-map, OpenHands scoping) is that handing the model structure up
// front stops it crawling the whole repo before it edits. Reuses buildGraph
// (src/mock/graph.ts) — this is just the formatting + neighborhood selection.

/** Find the graph node whose path matches `target` (exact, suffix, or substring). */
export function findNode(graph: ModuleGraph, target: string) {
  const t = target.replace(/^\.\//, '');
  const nodes = [...graph.nodes.values()];
  return (
    nodes.find((n) => n.path === t) ??
    nodes.find((n) => n.path.endsWith('/' + t) || n.path.endsWith(t)) ??
    nodes.find((n) => n.path.includes(t)) ??
    null
  );
}

/** Compact repo-map for a focus path: the target, its imports, and its importers. */
export function repoMapFor(graph: ModuleGraph, target: string): string {
  const node = findNode(graph, target);
  if (!node) return '';
  const importers = [...graph.nodes.values()]
    .filter((n) => n.imports.includes(node.path))
    .map((n) => n.path)
    .sort();
  return [
    `Repo map (focus: ${node.path}):`,
    `  ${node.path} [${node.kind}] imports: ${node.imports.length ? node.imports.join(', ') : '(none)'}`,
    `  imported by: ${importers.length ? importers.join(', ') : '(none)'}`,
    `Read the focus file first; these importers are its behavior contract — keep them working.`,
  ].join('\n');
}

/** The focus directive + repo-map appended to a path task when --only is set. */
export function focusDirective(graph: ModuleGraph | null, only: string): string {
  const map = graph ? repoMapFor(graph, only) : '';
  return (
    `\n\nFOCUS: work on \`${only}\` and its direct importers ONLY. Read that file first, then ` +
    `EDIT it — do not explore unrelated files.` +
    (map ? `\n\n${map}` : '')
  );
}
