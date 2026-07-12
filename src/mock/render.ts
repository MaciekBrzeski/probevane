import type { ModuleGraph, ModuleNode, NodeKind } from './graph.js';

// Render the module dependency graph for humans: a Mermaid diagram (renders in
// the wiki / GitHub) and an ASCII tree for the terminal. Edges point from a
// module to the modules it imports (dependent → dependency).

const ICON: Record<NodeKind, string> = { fetcher: '🌐', hook: '🪝', component: '🧩', util: '⚙️' };

/** Path → Mermaid-safe node id (alphanumerics/underscores only). */
function id(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_');
}
/** Human node label: path without the src/ prefix, plus the module kind. */
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

/** Module graph → Mermaid diagram (wiki/GitHub). Flat per-file nodes with kind
 *  colors while small; big graphs collapse to a directory-level overview. */
export function toMermaid(graph: ModuleGraph): string {
  // Big graphs (whole repos) are illegible as one flat node-per-file diagram, so
  // COLLAPSE to a directory-level overview: one node per top-level dir (with its
  // file count) + cross-directory edges. The per-file detail lives in the ASCII
  // tree. Small graphs stay flat with per-file nodes + kind colors.
  if (graph.nodes.size > 40) return dirLevelMermaid(graph);

  const lines = ['```mermaid', 'graph TD'];
  for (const n of graph.nodes.values()) {
    const net = n.callsNetwork ? ' 🌐' : '';
    lines.push(`  ${id(n.path)}["${label(n)}${net}"]:::${n.kind}`);
  }
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

/** Directory-level overview: one node per top-level dir + cross-dir edges. */
function dirLevelMermaid(graph: ModuleGraph): string {
  const dirs = new Map<string, { count: number; net: boolean }>();
  for (const n of graph.nodes.values()) {
    const d = topDir(n.path);
    const cur = dirs.get(d) ?? { count: 0, net: false };
    cur.count++;
    if (n.callsNetwork) cur.net = true;
    dirs.set(d, cur);
  }
  const edges = new Set<string>();
  for (const n of graph.nodes.values()) {
    const from = topDir(n.path);
    for (const dep of n.imports) {
      if (!graph.nodes.has(dep)) continue;
      const to = topDir(graph.nodes.get(dep)!.path);
      if (from !== to) edges.add(`${from}|${to}`); // skip intra-dir edges
    }
  }
  const lines = ['```mermaid', 'flowchart LR'];
  for (const [d, { count, net }] of [...dirs].sort()) lines.push(`  ${id(d)}["${d}/ (${count})${net ? ' 🌐' : ''}"]`);
  for (const e of [...edges].sort()) { const [a, b] = e.split('|'); lines.push(`  ${id(a)} --> ${id(b)}`); }
  lines.push('```');
  return lines.join('\n');
}

/** Modules imported by >= minImporters others — the hubs worth collapsing in
 *  the trees so they don't drown the layout. Most-shared first. */
export function sharedModules(graph: ModuleGraph, minImporters = 8): { path: string; importedBy: number }[] {
  const counts = new Map<string, number>();
  for (const n of graph.nodes.values()) {
    for (const d of n.imports) {
      if (!graph.nodes.has(d)) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, c]) => c >= minImporters)
    .map(([path, importedBy]) => ({ path, importedBy }))
    .sort((a, b) => (b.importedBy - a.importedBy) || a.path.localeCompare(b.path));
}

/** Module graph → ASCII dependency tree for the terminal: entry points at the
 *  roots, deps below; revisits marked ↺, hubs optionally collapsed as ⇗ shared. */
export function toAscii(graph: ModuleGraph, opts?: { collapseHubs?: number }): string {
  // Roots = modules nobody imports (the app's entry points). Walk down to deps.
  const imported = new Set<string>();
  for (const n of graph.nodes.values()) for (const d of n.imports) imported.add(d);
  const roots = [...graph.nodes.keys()].filter((p) => !imported.has(p)).sort();

  const collapseThreshold = opts?.collapseHubs;
  const hubs =
    collapseThreshold == null
      ? new Set<string>()
      : new Set(sharedModules(graph, collapseThreshold).map((m) => m.path));

  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (path: string, prefix: string, last: boolean, root: boolean) => {
    const n = graph.nodes.get(path);
    if (!n) return;
    const connector = root ? '' : last ? '└─ ' : '├─ ';
    const net = n.callsNetwork ? ' 🌐net' : '';
    const isHub = hubs.has(path);
    // A collapsed hub already signals "not expanded" via ⇗ shared — don't also
    // stack the ↺ revisit marker on it.
    const dup = seen.has(path) && !isHub ? ' ↺' : '';
    const hub = isHub ? ' ⇗ shared' : '';
    out.push(`${prefix}${connector}${ICON[n.kind]} ${n.path.replace(/^src\//, '')}${net}${dup}${hub}`);
    if (seen.has(path)) return;
    seen.add(path);
    if (hubs.has(path)) return;
    const childPrefix = root ? '' : prefix + (last ? '   ' : '│  ');
    const deps = n.imports.filter((d) => graph.nodes.has(d));
    deps.forEach((d, i) => walk(d, childPrefix, i === deps.length - 1, false));
  };
  roots.forEach((r, i) => walk(r, '', i === roots.length - 1, true));

  if (hubs.size > 0) {
    const list = sharedModules(graph, collapseThreshold!);
    out.push('', `Shared (imported by >=${collapseThreshold}):`);
    for (const m of list) out.push(`${m.path.replace(/^src\//, '')} (${m.importedBy})`);
  }

  return out.join('\n');
}

/** Filesystem view: the module paths as a nested folder tree with per-dir file
 *  counts. Distinct from toAscii (which is the dependency/import tree) — this is
 *  the on-disk layout, for comparing structure against coupling. */
type FolderDir = { files: string[]; tests: string[]; subs: Map<string, FolderDir> };

/** Render the on-disk folder tree. `testPaths` are counted separately and shown as
 *  a `+N test` suffix so a populated test dir (excluded from coupling) doesn't read
 *  as empty — the count that misled the critique into "populate/remove" findings. */
export function toFolderTree(paths: string[], testPaths: string[] = []): string {
  const root: FolderDir = { files: [], tests: [], subs: new Map() };
  const insert = (p: string, isTest: boolean) => {
    const parts = p.replace(/^\.\//, '').split('/');
    const file = parts.pop()!;
    let cur = root;
    for (const seg of parts) {
      if (!cur.subs.has(seg)) cur.subs.set(seg, { files: [], tests: [], subs: new Map() });
      cur = cur.subs.get(seg)!;
    }
    (isTest ? cur.tests : cur.files).push(file);
  };
  for (const p of [...paths].sort()) insert(p, false);
  for (const p of [...testPaths].sort()) insert(p, true);
  const out: string[] = [];
  const walk = (dir: FolderDir, name: string, prefix: string, last: boolean, root0: boolean) => {
    const src = countFiles(dir, 'files');
    const tests = countFiles(dir, 'tests');
    const label = tests ? (src ? `${src} +${tests} test` : `${tests} test`) : `${src}`;
    const connector = root0 ? '' : last ? '└─ ' : '├─ ';
    out.push(`${prefix}${connector}${name}/ (${label})`);
    const childPrefix = root0 ? '' : prefix + (last ? '   ' : '│  ');
    const subs = [...dir.subs.entries()].sort(([a], [b]) => a.localeCompare(b));
    subs.forEach(([n, d], i) => walk(d, n, childPrefix, i === subs.length - 1, false));
  };
  const topLevel = [...root.subs.entries()].sort(([a], [b]) => a.localeCompare(b));
  topLevel.forEach(([n, d], i) => walk(d, n, '', i === topLevel.length - 1, true));
  return out.join('\n');
}

/** Files of one kind under a directory (recursive). */
function countFiles(dir: FolderDir, kind: 'files' | 'tests'): number {
  let n = dir[kind].length;
  for (const sub of dir.subs.values()) n += countFiles(sub, kind);
  return n;
}

/** One-line stats (module count by kind + how many touch the network) for logs. */
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
