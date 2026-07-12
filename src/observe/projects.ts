import type { RunRecord } from '../cost/ledger.js';

// Project list for the control center — derives the set of known projects from the
// wiki's project-*.md pages (the same list the wiki sidebar shows) and cross-refs
// the run ledger to attach run counts + last-run status. Pure: the daemon passes
// in the md filenames + ledger records. Best-effort matching (see projectOf).

export interface LastRun {
  runId: string;
  ts: string;
  op: string;
  accepted: boolean;
  stopReason: string;
  cost: number;
}

/** One project row for the control center — wiki-page identity plus
 *  ledger-derived run stats. Built by buildProjects(). */
export interface ProjectSummary {
  name: string; // display name, e.g. "react-shop"
  slug: string; // wiki page slug, e.g. "project-react-shop"
  runCount: number;
  acceptRate: number; // 0..1 over matched runs (0 when none)
  lastRun?: LastRun;
}

/** Strip a "project-<name>.md" wiki filename to its display name. */
export function projectName(mdFile: string): string {
  return mdFile.replace(/^project-/, '').replace(/\.md$/, '');
}

/** The project a ledger record belongs to: the basename of its label target
 *  ("op:some/path/react-shop" → "react-shop"). Best-effort — basenames can
 *  collide across paths; a caller wanting precision should match full targets. */
export function projectOf(label: string): string {
  const target = label.includes(':') ? label.slice(label.indexOf(':') + 1) : label;
  const clean = target.replace(/[/\\]+$/, ''); // drop trailing slash
  const base = clean.split(/[/\\]/).pop() ?? clean;
  return base || clean;
}

/** The op prefix of a label ("generate:fixtures/x" → "generate"). */
function opOf(label: string): string {
  return label.includes(':') ? label.slice(0, label.indexOf(':')) : label;
}

/** Newest record by ts (ISO-8601 sorts lexically). */
function newest(records: RunRecord[]): RunRecord | undefined {
  let best: RunRecord | undefined;
  for (const r of records) if (!best || r.ts > best.ts) best = r;
  return best;
}

/** Build the project summaries: one per wiki project page, enriched from the
 *  ledger. Sorted by most-recent activity, then name. */
export function buildProjects(mdFiles: string[], records: RunRecord[]): ProjectSummary[] {
  const byProject = new Map<string, RunRecord[]>();
  for (const r of records) {
    const p = projectOf(r.label);
    (byProject.get(p) ?? byProject.set(p, []).get(p)!).push(r);
  }
  const projects = mdFiles
    .filter((f) => /^project-.*\.md$/.test(f))
    .map((f) => {
      const name = projectName(f);
      const matched = byProject.get(name) ?? [];
      const accepted = matched.filter((r) => r.accepted).length;
      const last = newest(matched);
      const summary: ProjectSummary = {
        name,
        slug: `project-${name}`,
        runCount: matched.length,
        acceptRate: matched.length ? accepted / matched.length : 0,
      };
      if (last) {
        summary.lastRun = {
          runId: last.runId,
          ts: last.ts,
          op: opOf(last.label),
          accepted: last.accepted,
          stopReason: last.stopReason,
          cost: last.cost,
        };
      }
      return summary;
    });
  return projects.sort((a, b) => {
    const at = a.lastRun?.ts ?? '';
    const bt = b.lastRun?.ts ?? '';
    if (at !== bt) return bt.localeCompare(at); // most recent first
    return a.name.localeCompare(b.name);
  });
}
