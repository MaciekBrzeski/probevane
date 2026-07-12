import type { ModuleGraph } from '../../mock/graph.js';
import { topDir } from './metrics.js';

// The pyramid structure model — evaluate a codebase against "isolated feature
// pyramids on a glue base": each feature dir is a pyramid (subfolder depth =
// how private/specific a module is; the dir's top level is its public base),
// root-level glue is the connection layer that wires pyramids together and
// owns input/output, and shared dirs are the common base every pyramid may
// stand on. Report-only, pure: given a ModuleGraph, classify dirs into roles
// and surface the imports that break the model, each priced in import
// statements to rewrite (same cost currency as arch metrics).
//
// Rules the model checks:
//   1. feature→feature — pyramids must not touch; route through glue, promote
//      the target to shared, or merge them.
//   2. feature→glue — inversion; a pyramid may never depend on the wiring.
//   3. shared→feature — the base must not depend on a tip.
//   4. deep-reach — glue may only touch a pyramid's base (top-level files);
//      importing from a subfolder reaches past the public surface.

export type DirRole = 'glue' | 'shared' | 'feature';

export interface RoleOverrides {
  glue?: string[];
  shared?: string[];
  feature?: string[]; // pin as a pyramid even when coupling suggests glue/shared
}

export interface PyramidDir {
  dir: string;
  role: DirRole;
  files: number;
  intra: number; // import statements that stay inside the pyramid
  leaks: number; // cross-dir import statements that violate a rule
  isolation: number; // intra / (intra + leaks) — 1 = perfectly isolated
}

export type ViolationKind = 'feature→feature' | 'feature→glue' | 'shared→feature' | 'deep-reach';

export interface PyramidViolation {
  kind: ViolationKind;
  from: string;
  to: string;
  count: number; // import statements = the cost to fix
  examples: string[]; // up to 3 "from.ts → to.ts"
  fix: string;
}

export interface PyramidReport {
  dirs: PyramidDir[];
  violations: PyramidViolation[]; // sorted by count desc
  score: number; // 0-100: share of cross-dir imports that respect the model
}

const FIX: Record<ViolationKind, string> = {
  'feature→feature': 'route through glue, promote the target to shared, or merge the pyramids',
  'feature→glue': 'inversion — move the needed piece out of glue into shared or the feature',
  'shared→feature': 'the base depends on a tip — move the dependency into shared or invert it',
  'deep-reach': 'glue reaches past the pyramid base — re-export from the feature top level',
};

/** Segments of a path inside its top-level dir (`src/loop/runes/x.ts` → ['runes','x.ts']). */
function relSegments(path: string): string[] {
  const parts = path.replace(/^\.\//, '').split('/');
  const rel = parts[0] === 'src' ? parts.slice(1) : parts;
  return rel.slice(1);
}

/** Infer a dir's role from its coupling; explicit overrides always win. */
export function inferRole(
  dir: string,
  c: { fanIn: number; fanOut: number },
  overrides: RoleOverrides = {},
): DirRole {
  if (overrides.glue?.includes(dir)) return 'glue';
  if (overrides.shared?.includes(dir)) return 'shared';
  if (overrides.feature?.includes(dir)) return 'feature';
  if (dir.includes('.')) return 'glue'; // bare root-level file = connection layer
  if (c.fanIn >= 4 && c.fanOut <= 2) return 'shared'; // broad base, few needs of its own
  // Imports far more than it is imported = composition root. Not strict fanIn 0:
  // a single feature→glue violation must not demote the glue and hide itself.
  if (c.fanOut >= 2 && c.fanOut > c.fanIn * 2) return 'glue';
  return 'feature';
}

/** Dir-level fanIn/fanOut (distinct dirs), for role inference. */
function dirCoupling(graph: ModuleGraph): Map<string, { fanIn: number; fanOut: number; files: number }> {
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const files = new Map<string, number>();
  for (const n of graph.nodes.values()) {
    const from = topDir(n.path);
    files.set(from, (files.get(from) ?? 0) + 1);
    for (const dep of n.imports) {
      const target = graph.nodes.get(dep);
      if (!target) continue;
      const to = topDir(target.path);
      if (from === to) continue;
      (out.get(from) ?? out.set(from, new Set()).get(from)!).add(to);
      (inn.get(to) ?? inn.set(to, new Set()).get(to)!).add(from);
    }
  }
  const coupling = new Map<string, { fanIn: number; fanOut: number; files: number }>();
  for (const [dir, f] of files)
    coupling.set(dir, { fanIn: inn.get(dir)?.size ?? 0, fanOut: out.get(dir)?.size ?? 0, files: f });
  return coupling;
}

/** Which rule (if any) does one cross-dir import break? */
function violationKind(fromRole: DirRole, toRole: DirRole, deep: boolean): ViolationKind | null {
  if (fromRole === 'feature' && toRole === 'feature') return 'feature→feature';
  if (fromRole === 'feature' && toRole === 'glue') return 'feature→glue';
  if (fromRole === 'shared' && toRole === 'feature') return 'shared→feature';
  if (fromRole === 'glue' && toRole === 'feature' && deep) return 'deep-reach';
  return null; // anyone→shared, glue→base-of-feature, glue→glue: all legal
}

/** Mutable tallies accumulated while walking every import edge. */
interface Tally {
  intra: Map<string, number>;
  leaks: Map<string, number>;
  agg: Map<string, PyramidViolation>;
  cross: number;
  bad: number;
}

/** Record one import edge into the tallies (intra, legal cross, or violation). */
function tallyImport(t: Tally, roles: Map<string, DirRole>, fromPath: string, toPath: string): void {
  const from = topDir(fromPath);
  const to = topDir(toPath);
  if (from === to) {
    t.intra.set(from, (t.intra.get(from) ?? 0) + 1);
    return;
  }
  t.cross++;
  const kind = violationKind(roles.get(from)!, roles.get(to)!, relSegments(toPath).length > 1);
  if (!kind) return;
  t.bad++;
  t.leaks.set(from, (t.leaks.get(from) ?? 0) + 1);
  const key = `${kind}|${from}|${to}`;
  const v = t.agg.get(key) ?? { kind, from, to, count: 0, examples: [], fix: FIX[kind] };
  v.count++;
  if (v.examples.length < 3) v.examples.push(`${fromPath} → ${toPath}`);
  t.agg.set(key, v);
}

/** Evaluate the graph against the pyramid model. */
export function pyramidReport(graph: ModuleGraph, overrides: RoleOverrides = {}): PyramidReport {
  const coupling = dirCoupling(graph);
  const roles = new Map<string, DirRole>();
  for (const [dir, c] of coupling) roles.set(dir, inferRole(dir, c, overrides));

  const t: Tally = { intra: new Map(), leaks: new Map(), agg: new Map(), cross: 0, bad: 0 };
  for (const n of graph.nodes.values())
    for (const dep of n.imports) {
      const target = graph.nodes.get(dep);
      if (target) tallyImport(t, roles, n.path, target.path);
    }

  const dirs: PyramidDir[] = [...coupling.entries()]
    .map(([dir, c]) => {
      const i = t.intra.get(dir) ?? 0;
      const l = t.leaks.get(dir) ?? 0;
      const isolation = i + l === 0 ? 1 : i / (i + l);
      return { dir, role: roles.get(dir)!, files: c.files, intra: i, leaks: l, isolation };
    })
    .sort((a, b) => a.isolation - b.isolation || b.files - a.files);
  const violations = [...t.agg.values()].sort((a, b) => b.count - a.count);
  const score = t.cross === 0 ? 100 : Math.round(100 * (1 - t.bad / t.cross));
  return { dirs, violations, score };
}

/** Compact text digest of the pyramid report for the CLI / an LLM prompt. */
export function pyramidDigest(r: PyramidReport): string {
  const byRole = (role: DirRole) => r.dirs.filter((d) => d.role === role).map((d) => d.dir).sort();
  const lines: string[] = [
    '## Pyramid model (features = isolated pyramids · glue = connection layer · shared = common base)',
    `Roles — glue: ${byRole('glue').join(', ') || 'none'} · shared: ${byRole('shared').join(', ') || 'none'} · features: ${byRole('feature').join(', ') || 'none'}`,
    '',
    '### Feature isolation (intra-pyramid imports vs rule-breaking leaks)',
  ];
  for (const d of r.dirs.filter((x) => x.role === 'feature'))
    lines.push(`- ${d.dir}/  ${Math.round(d.isolation * 100)}% isolated (${d.intra} intra · ${d.leaks} leak)`);
  lines.push('', '### Violations (count = import statements to rewrite)');
  if (!r.violations.length) lines.push('- none — the structure already fits the model');
  for (const v of r.violations)
    lines.push(`- [${v.kind}] ${v.from} → ${v.to} (${v.count})  fix: ${v.fix}\n  e.g. ${v.examples.join(' · ')}`);
  lines.push('', `### Pyramid score: ${r.score}/100 (share of cross-dir imports that respect the model)`);
  return lines.join('\n');
}
