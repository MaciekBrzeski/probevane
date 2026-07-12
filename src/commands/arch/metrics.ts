import type { ModuleGraph } from '../../mock/graph.js';

// Architecture signals derived from the module dependency graph — the raw
// material the `arch` critique feeds an LLM (plus the two rendered trees). All
// pure: given a ModuleGraph, compute directory sizes, cross-directory coupling,
// and directory-level cycles. No filesystem, no LLM.

/** Top-level dir of a project-relative path (`src/cli/x.ts` → `cli`, `src/config.ts` → `config.ts`). */
export function topDir(path: string): string {
  const parts = path.replace(/^\.\//, '').split('/');
  const rel = parts[0] === 'src' ? parts.slice(1) : parts;
  return rel.length > 1 ? rel[0] : rel[0]; // a bare file under src keeps its filename as the bucket
}

/** Per-directory coupling row — size, fan-in/out, and the weighted inbound
 *  count that prices a relocation. Computed by archMetrics. */
export interface DirCoupling {
  dir: string;
  files: number;
  fanOut: number; // distinct other dirs this dir imports FROM
  fanIn: number; // distinct other dirs that import this dir
  inbound: number; // weighted count of import STATEMENTS from other dirs — ≈ the churn to relocate this dir (every one is a `../dir/x.js` that rewrites)
  imports: string[]; // dirs it depends on
}

/** The directory-level view of the module graph: coupling rows, weighted
 *  cross-dir edges, mutual-import cycles. Output of archMetrics; input to
 *  archDigest and archDrift. */
export interface ArchMetrics {
  dirs: DirCoupling[];
  edges: { from: string; to: string; count: number }[]; // cross-dir import edges (weighted)
  cycles: [string, string][]; // dir pairs that import each other (A↔B)
}

/** Per-dir file counts + weighted cross-dir edge map ("from|to" → count). */
function tallyDirs(graph: ModuleGraph): { files: Map<string, number>; edgeCount: Map<string, number> } {
  const files = new Map<string, number>();
  const edgeCount = new Map<string, number>();
  for (const n of graph.nodes.values()) {
    const from = topDir(n.path);
    files.set(from, (files.get(from) ?? 0) + 1);
    for (const dep of n.imports) {
      const target = graph.nodes.get(dep);
      if (!target) continue;
      const to = topDir(target.path);
      if (from === to) continue; // intra-dir edges don't couple directories
      edgeCount.set(`${from}|${to}`, (edgeCount.get(`${from}|${to}`) ?? 0) + 1);
    }
  }
  return { files, edgeCount };
}

/** Compute directory-level coupling + cycles from the module graph. */
export function archMetrics(graph: ModuleGraph): ArchMetrics {
  const { files, edgeCount } = tallyDirs(graph);
  const efferent = new Map<string, Set<string>>();
  const afferent = new Map<string, Set<string>>();
  const inbound = new Map<string, number>(); // weighted incoming import statements per dir
  const edges: { from: string; to: string; count: number }[] = [];
  for (const [key, count] of edgeCount) {
    const [from, to] = key.split('|');
    edges.push({ from, to, count });
    (efferent.get(from) ?? efferent.set(from, new Set()).get(from)!).add(to);
    (afferent.get(to) ?? afferent.set(to, new Set()).get(to)!).add(from);
    inbound.set(to, (inbound.get(to) ?? 0) + count);
  }
  const dirs: DirCoupling[] = [...files.entries()]
    .map(([dir, f]) => ({
      dir,
      files: f,
      fanOut: efferent.get(dir)?.size ?? 0,
      fanIn: afferent.get(dir)?.size ?? 0,
      inbound: inbound.get(dir) ?? 0,
      imports: [...(efferent.get(dir) ?? [])].sort(),
    }))
    .sort((a, b) => b.files - a.files || a.dir.localeCompare(b.dir));
  // Dir cycles: A imports B AND B imports A.
  const seen = new Set<string>();
  const cycles: [string, string][] = [];
  for (const { from, to } of edges) {
    if (edgeCount.has(`${to}|${from}`)) {
      const key = [from, to].sort().join('|');
      if (!seen.has(key)) { seen.add(key); cycles.push([from, to]); }
    }
  }
  return { dirs, edges: edges.sort((a, b) => b.count - a.count), cycles };
}

/**
 * Diff two metric snapshots into human-readable drift lines. Report-only —
 * feeds `arch --snapshot`, which prints drift against the committed snapshot
 * so coupling regressions become visible over time. Empty array = no drift.
 */
export function archDrift(prev: ArchMetrics, next: ArchMetrics, minEdgeDelta = 3): string[] {
  return [...dirDrift(prev, next), ...edgeDrift(prev, next, minEdgeDelta), ...cycleDrift(prev, next)];
}

/** Dir-level drift: added/removed dirs plus per-dir file and fanOut changes. */
function dirDrift(prev: ArchMetrics, next: ArchMetrics): string[] {
  const out: string[] = [];
  const prevDirs = new Map(prev.dirs.map((d) => [d.dir, d]));
  const nextDirs = new Map(next.dirs.map((d) => [d.dir, d]));
  for (const [dir, d] of nextDirs) {
    const p = prevDirs.get(dir);
    if (!p) { out.push(`+ dir ${dir}/ (${d.files} files)`); continue; }
    if (p.files !== d.files) out.push(`~ ${dir}/ files ${p.files} → ${d.files}`);
    if (p.fanOut !== d.fanOut) out.push(`~ ${dir}/ fanOut ${p.fanOut} → ${d.fanOut}`);
  }
  for (const dir of prevDirs.keys()) if (!nextDirs.has(dir)) out.push(`- dir ${dir}/ removed`);
  return out;
}

/** Edge drift: cross-dir edges whose weight moved by >= minEdgeDelta —
 *  smaller wobble is churn noise, not an architecture signal. */
function edgeDrift(prev: ArchMetrics, next: ArchMetrics, minEdgeDelta: number): string[] {
  const out: string[] = [];
  const prevEdges = new Map(prev.edges.map((e) => [`${e.from}|${e.to}`, e.count]));
  const nextEdges = new Map(next.edges.map((e) => [`${e.from}|${e.to}`, e.count]));
  for (const [key, count] of nextEdges) {
    const before = prevEdges.get(key) ?? 0;
    if (Math.abs(count - before) >= minEdgeDelta)
      out.push(`~ edge ${key.replace('|', ' → ')} ${before} → ${count}`);
  }
  for (const [key, count] of prevEdges)
    if (!nextEdges.has(key) && count >= minEdgeDelta) out.push(`- edge ${key.replace('|', ' → ')} dropped (was ${count})`);
  return out;
}

/** Cycle drift: new A↔B dir cycles are flagged, resolved ones acknowledged. */
function cycleDrift(prev: ArchMetrics, next: ArchMetrics): string[] {
  const out: string[] = [];
  const cyc = (m: ArchMetrics) => new Set(m.cycles.map(([a, b]) => [a, b].sort().join('↔')));
  const pc = cyc(prev), nc = cyc(next);
  for (const c of nc) if (!pc.has(c)) out.push(`+ CYCLE ${c}`);
  for (const c of pc) if (!nc.has(c)) out.push(`✓ cycle ${c} resolved`);
  return out;
}

/** A compact text digest of the metrics for an LLM prompt. */
export function archDigest(m: ArchMetrics): string {
  const lines: string[] = [
    '## Directory coupling (files · fanOut→ · fanIn← · move-cost)',
    '_move-cost ≈ import statements from other dirs that rewrite if this dir is relocated — weigh every suggested move against it._',
  ];
  for (const d of m.dirs) lines.push(`- ${d.dir}/  ${d.files} files · out ${d.fanOut} · in ${d.fanIn} · ~${d.inbound} to move${d.imports.length ? `  → ${d.imports.join(', ')}` : ''}`);
  lines.push('', '## Heaviest cross-dir edges');
  for (const e of m.edges.slice(0, 15)) lines.push(`- ${e.from} → ${e.to}  (${e.count})`);
  lines.push('', `## Directory cycles: ${m.cycles.length ? m.cycles.map(([a, b]) => `${a}↔${b}`).join(', ') : 'none'}`);
  return lines.join('\n');
}
