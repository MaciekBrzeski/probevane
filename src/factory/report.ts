// Pure factory report core — repo-list parsing, per-repo slug, and the rollup.
// Kept separate from run.ts (process/fs orchestration) so it's unit-testable and
// counts toward coverage; run.ts is excluded like the other I/O glue.
import type { MfeViolation } from '../mfe/standards.js';

export interface FactoryRepoResult {
  repo: string;
  accepted: boolean;
  stopReason: string;
  tests: number;
  coverage: number | null;
  cost: number;
  tokensIn: number;
  tokensOut: number;
  reverted: boolean;
  cached?: boolean; // skipped via --resume (carried from a prior report)
  shipped?: boolean; // delivered as a branch/PR (--ship)
  prUrl?: string;
  error?: string;
}

export interface FactoryReport {
  ts: string;
  repos: number;
  accepted: number;
  acceptRate: number;
  totalCost: number;
  totalTests: number;
  byStopReason: Record<string, number>; // error-mode breakdown across repos
  mfeVersionAlign?: MfeViolation[]; // cross-repo MF shared-version misalignments (when MFEs)
  results: FactoryRepoResult[];
}

/** Repos that ACCEPTED in a prior report — used by --resume to skip re-running them. */
export function acceptedRepos(prior: FactoryReport | null | undefined): Set<string> {
  return new Set((prior?.results ?? []).filter((r) => r.accepted).map((r) => r.repo));
}

/** Parse a repo-list file: one path per line, blank lines + `#` comments skipped. */
export function parseRepoList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Filesystem-safe per-repo state subdir name. */
export function slug(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'repo';
}

/** Roll per-repo results into the headline report (pure — the testable core). */
export function aggregate(results: FactoryRepoResult[], ts: string): FactoryReport {
  const accepted = results.filter((r) => r.accepted).length;
  const byStopReason: Record<string, number> = {};
  for (const r of results) byStopReason[r.stopReason] = (byStopReason[r.stopReason] ?? 0) + 1;
  return {
    ts,
    repos: results.length,
    accepted,
    acceptRate: results.length ? +(accepted / results.length).toFixed(3) : 0,
    totalCost: Math.round(results.reduce((a, r) => a + r.cost, 0) * 1e6) / 1e6,
    totalTests: results.reduce((a, r) => a + r.tests, 0),
    byStopReason,
    results,
  };
}
