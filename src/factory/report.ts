// Pure factory report core — repo-list parsing, per-repo slug, and the rollup.
// Kept separate from run.ts (process/fs orchestration) so it's unit-testable and
// counts toward coverage; run.ts is excluded like the other I/O glue.

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
  error?: string;
}

export interface FactoryReport {
  ts: string;
  repos: number;
  accepted: number;
  acceptRate: number;
  totalCost: number;
  totalTests: number;
  results: FactoryRepoResult[];
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
  return {
    ts,
    repos: results.length,
    accepted,
    acceptRate: results.length ? +(accepted / results.length).toFixed(3) : 0,
    totalCost: Math.round(results.reduce((a, r) => a + r.cost, 0) * 1e6) / 1e6,
    totalTests: results.reduce((a, r) => a + r.tests, 0),
    results,
  };
}
