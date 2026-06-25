import type { ModuleGraph, ModuleNode, NodeKind } from './graph.js';

// Render the module dependency graph for humans: a Mermaid diagram (renders in
// the wiki / GitHub) and an ASCII tree for the terminal. Edges point from a
// module to the modules it imports (dependent → dependency).

const ICON: Record<NodeKind, string> = { fetcher: '🌐', hook: '🪝', component: '🧩', util: '⚙️' };

function id(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_');
}
function label(n: ModuleNode): string {
  const base = n.path.replace(/^src\//, '');
  return `${base} (${n.kind})`;
}

/** Extract the top-level directory from a project-relative path like `src/cli/foo.ts` → `cli`. */
function topDir(path: string): string {
  const parts = path.split('/');
  // paths are like "src/<dir>/…" — take the segment after "src"
  return parts.length >= 2 ? (parts[0] === 'src' ? parts[1] : parts[0]) : parts[0];
}

export function toMermaid(graph: ModuleGraph): string {
  const lines = ['```mermaid', 'graph TD'];

  if (graph.nodes.size > 40) {
    // Group node declarations into subgraph blocks keyed by top-level directory
    const byDir = new Map<string, ModuleNode[]>();
    for (const n of graph.nodes.values()) {
      const dir = topDir(n.path);
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(n);
    }
    for (const [dir, nodes] of byDir) {
      lines.push(`  subgraph ${dir}`);
      for (const n of nodes) {
        const net = n.callsNetwork ? ' 🌐' : '';
        lines.push(`    ${id(n.path)}["${label(n)}${net}"]:::${n.kind}`);
      }
      lines.push(`  end`);
    }
  } else {
    // Flat output (≤40 nodes)
    for (const n of graph.nodes.values()) {
      const net = n.callsNetwork ? ' 🌐' : '';
      lines.push(`  ${id(n.path)}["${label(n)}${net}"]:::${n.kind}`);
    }
  }

  // Edges always come after node/subgraph declarations
  for (const n of graph.nodes.values())
    for (const dep of n.imports) if (graph.nodes.has(dep)) lines.push(`  ${id(n.path)} --> ${id(dep)}`);

  lines.push(
    '  classDef fetcher fill:#fde2e2,stroke:#c0392b;',
    '  classDef hook fill:#e2ecfd,stroke:#2b6cb0;',
    '  classDef component fill:#e6f7e6,stroke:#27ae60;',
    '  classDef util fill:#f0f0f0,stroke:#888;',
    '```',
  );
  return lines.join('\n');
}

export function toAscii(graph: ModuleGraph): string {
  // Roots = modules nobody imports (the app's entry points). Walk down to deps.
  const imported = new Set<string>();
  for (const n of graph.nodes.values()) for (const d of n.imports) imported.add(d);
  const roots = [...graph.nodes.keys()].filter((p) => !imported.has(p)).sort();

  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (path: string, prefix: string, last: boolean, root: boolean) => {
    const n = graph.nodes.get(path);
    if (!n) return;
    const connector = root ? '' : last ? '└─ ' : '├─ ';
    const net = n.callsNetwork ? ' 🌐net' : '';
    const dup = seen.has(path) ? ' ↺' : '';
    out.push(`${prefix}${connector}${ICON[n.kind]} ${n.path.replace(/^src\//, '')}${net}${dup}`);
    if (seen.has(path)) return;
    seen.add(path);
    const childPrefix = root ? '' : prefix + (last ? '   ' : '│  ');
    const deps = n.imports.filter((d) => graph.nodes.has(d));
    deps.forEach((d, i) => walk(d, childPrefix, i === deps.length - 1, false));
  };
  roots.forEach((r, i) => walk(r, '', i === roots.length - 1, true));
  return out.join('\n');
}

export function graphSummary(graph: ModuleGraph): string {
  const byKind: Record<string, number> = {};
  let net = 0;
  for (const n of graph.nodes.values()) {
    byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    if (n.callsNetwork) net++;
  }
  const kinds = Object.entries(byKind).map(([k, c]) => `${c} ${k}`).join(', ');
  return `${graph.nodes.size} modules (${kinds}); ${net} touch the network`;
}
