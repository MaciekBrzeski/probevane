import type { ModuleGraph } from '../../mock/graph.js';

// Folder-crowding check — a dir holding too many files is a cognitive load
// problem regardless of import hygiene. For every dir (any depth) over the
// threshold, propose concrete relief, report-only:
//   1. subfolder candidates — ≥3 files sharing a name prefix (`engine-*.ts`)
//      already form a de-facto group; a subfolder makes it real.
//   2. misplaced files — a file with ZERO intra-dir coupling (imports nothing
//      here, nothing here imports it) whose importers all live elsewhere
//      probably belongs with its callers.

export interface PrefixCluster {
  prefix: string;
  files: string[]; // basenames
}

export interface MisplacedFile {
  file: string; // basename
  suggest: string; // the dir that pulls it
  pulls: number; // import statements from that dir
}

export interface DirCrowding {
  dir: string; // full dir path, e.g. 'src/cli'
  files: number;
  clusters: PrefixCluster[];
  misplaced: MisplacedFile[];
}

const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/'));
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
/** `engine-phases.ts` → `engine`; `runspec.ts` → `runspec`. */
const prefixOf = (base: string): string => base.replace(/\.[a-z]+$/, '').split(/[-_.]/)[0];

/** Same-prefix groups of ≥3 files — each is a ready-made subfolder. */
function prefixClusters(basenames: string[]): PrefixCluster[] {
  const byPrefix = new Map<string, string[]>();
  for (const b of basenames) {
    const p = prefixOf(b);
    (byPrefix.get(p) ?? byPrefix.set(p, []).get(p)!).push(b);
  }
  return [...byPrefix.entries()]
    .filter(([, fs]) => fs.length >= 3)
    .map(([prefix, fs]) => ({ prefix, files: fs.sort() }))
    .sort((a, b) => b.files.length - a.files.length);
}

/** Files with zero intra-dir coupling whose importers cluster elsewhere.
 *  Skipped: files claimed by a prefix cluster (the subfolder suggestion takes
 *  precedence), index.* (a dir's public base is wired from outside by design),
 *  and ≥3 files all pulled toward the SAME dir (registry pattern — sibling
 *  plugins each imported once by an external orchestrator, e.g. runes/). */
function misplacedFiles(members: Set<string>, clustered: Set<string>, graph: ModuleGraph): MisplacedFile[] {
  const out: MisplacedFile[] = [];
  for (const path of members) {
    const base = baseOf(path);
    if (clustered.has(base) || /^index\./.test(base)) continue;
    const n = graph.nodes.get(path)!;
    if (n.imports.some((i) => members.has(i))) continue; // uses a sibling → cohesive
    const pulls = new Map<string, number>();
    let siblingImporter = false;
    for (const other of graph.nodes.values()) {
      if (!other.imports.includes(path)) continue;
      if (members.has(other.path)) { siblingImporter = true; break; }
      const d = dirOf(other.path);
      pulls.set(d, (pulls.get(d) ?? 0) + 1);
    }
    if (siblingImporter || pulls.size !== 1) continue; // cohesive, shared, or unused
    const [suggest, count] = [...pulls.entries()][0];
    out.push({ file: base, suggest, pulls: count });
  }
  const bySuggest = new Map<string, number>();
  for (const m of out) bySuggest.set(m.suggest, (bySuggest.get(m.suggest) ?? 0) + 1);
  return out.filter((m) => bySuggest.get(m.suggest)! < 3).sort((a, b) => b.pulls - a.pulls);
}

/** Dirs over `maxFiles` direct source files, each with its relief suggestions. */
export function crowdingReport(graph: ModuleGraph, maxFiles = 15): DirCrowding[] {
  const byDir = new Map<string, Set<string>>();
  for (const n of graph.nodes.values()) {
    const d = dirOf(n.path);
    (byDir.get(d) ?? byDir.set(d, new Set()).get(d)!).add(n.path);
  }
  return [...byDir.entries()]
    .filter(([, members]) => members.size > maxFiles)
    .map(([dir, members]) => {
      const clusters = prefixClusters([...members].map(baseOf));
      const clustered = new Set(clusters.flatMap((c) => c.files));
      return { dir, files: members.size, clusters, misplaced: misplacedFiles(members, clustered, graph) };
    })
    .sort((a, b) => b.files - a.files);
}

/** Compact text digest for the CLI / an LLM prompt. Empty string = nothing crowded. */
export function crowdingDigest(crowded: DirCrowding[], maxFiles = 15): string {
  if (!crowded.length) return '';
  const lines = [`## Crowded dirs (> ${maxFiles} direct files — consider subfolders or moving files out)`];
  for (const c of crowded) {
    lines.push(`- ${c.dir}/  ${c.files} files`);
    for (const cl of c.clusters)
      lines.push(`  · subfolder candidate ${c.dir}/${cl.prefix}/ — ${cl.files.length} files share the "${cl.prefix}" prefix (${cl.files.slice(0, 4).join(', ')}${cl.files.length > 4 ? ', …' : ''})`);
    for (const m of c.misplaced)
      lines.push(`  · ${m.file} has no ties here — only ${m.suggest}/ imports it (${m.pulls}×); consider moving it there (runtime imports only — grep for type-only importers before moving)`);
    if (!c.clusters.length && !c.misplaced.length)
      lines.push('  · no mechanical split found — needs a judgement call');
  }
  return lines.join('\n');
}
