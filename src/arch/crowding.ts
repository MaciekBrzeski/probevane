import type { ModuleGraph } from '../mock/graph.js';

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

/** A file with zero intra-dir coupling whose importers all live elsewhere —
 *  `suggest` is the dir that pulls it. Emitted by the crowding scan as a
 *  concrete move candidate. */
export interface MisplacedFile {
  file: string; // basename
  suggest: string; // the dir that pulls it
  pulls: number; // import statements from that dir
}

/** One over-threshold dir with its relief options: prefix clusters ready to
 *  become subfolders and misplaced files to move out. Built by crowdingReport. */
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
/** A zero-cohesion member pulled by exactly one OUTSIDE dir → its move suggestion;
 *  null if it uses/serves a sibling (cohesive), is shared, unused, or an index file. */
function misplaceOf(
  path: string, members: Set<string>, clustered: Set<string>, graph: ModuleGraph,
): MisplacedFile | null {
  const base = baseOf(path);
  if (clustered.has(base) || /^index\./.test(base)) return null;
  if (graph.nodes.get(path)!.imports.some((i) => members.has(i))) return null; // uses a sibling → cohesive
  const pulls = new Map<string, number>();
  for (const other of graph.nodes.values()) {
    if (!other.imports.includes(path)) continue;
    if (members.has(other.path)) return null; // a sibling imports it → cohesive
    pulls.set(dirOf(other.path), (pulls.get(dirOf(other.path)) ?? 0) + 1);
  }
  if (pulls.size !== 1) return null; // shared or unused
  const [suggest, count] = [...pulls.entries()][0];
  return { file: base, suggest, pulls: count };
}

/** Zero-cohesion files in a dir that a single other dir pulls (move candidates),
 *  suppressing suggestions that would over-fill any one target (<3). */
function misplacedFiles(members: Set<string>, clustered: Set<string>, graph: ModuleGraph): MisplacedFile[] {
  const out: MisplacedFile[] = [];
  for (const path of members) {
    const m = misplaceOf(path, members, clustered, graph);
    if (m) out.push(m);
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
