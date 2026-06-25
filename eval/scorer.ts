import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { StackAdapter, RunScope } from '../src/adapters/adapter.js';
import { auditFiles } from '../src/audit/core.js';

// scorer — measures a fixture's test suite (fourier metrics): green, count,
// audit score, coverage, flake, and shadow-oracle assertion coverage.

export interface Score {
  green: boolean;
  tests: number;
  failed: number;
  skipped: number;
  auditScore: number;
  auditErrors: number;
  coverage: number; // statements %
  flake: number; // 0..1 fraction of runs differing from the first
  oracleHit: number;
  oracleTotal: number;
}

export interface ScoreOpts {
  scope: RunScope;
  flakeRuns?: number;
  oracleAssertions?: string[];
}

export async function scoreFixture(dir: string, adapter: StackAdapter, opts: ScoreOpts): Promise<Score> {
  const flakeRuns = opts.flakeRuns ?? 3;

  // Repeated runs for flake.
  const runs = [];
  for (let i = 0; i < flakeRuns; i++) runs.push(await adapter.run(dir, opts.scope));
  const first = runs[0];
  const signature = (r: { passed: number; failed: number }) => `${r.passed}/${r.failed}`;
  const differing = runs.filter((r) => signature(r) !== signature(first)).length;
  const flake = flakeRuns > 1 ? differing / flakeRuns : 0;

  // Coverage (unit scope only; e2e coverage is not meaningful here).
  let coverage = 0;
  if (opts.scope === 'unit' || opts.scope === 'all') {
    const cov = await adapter.coverage(dir).catch(() => null);
    coverage = cov?.ok ? cov.statements : 0;
  }

  // Audit over the spec files.
  const specs = await adapter.specFiles(dir);
  const report = await auditFiles(specs.map((s) => join(dir, s)), adapter.auditRules());

  // Shadow-oracle: required assertion substrings must appear in the suite text.
  let oracleHit = 0;
  const oracle = opts.oracleAssertions ?? [];
  if (oracle.length) {
    let all = '';
    for (const s of specs) all += (await readFile(join(dir, s), 'utf8').catch(() => '')) + '\n';
    oracleHit = oracle.filter((a) => all.includes(a)).length;
  }

  return {
    green: first.green,
    tests: first.passed,
    failed: first.failed,
    skipped: first.skipped,
    auditScore: report.score,
    auditErrors: report.errors,
    coverage,
    flake,
    oracleHit,
    oracleTotal: oracle.length,
  };
}

export interface Baseline {
  scope: RunScope;
  minTests: number;
  minCoverage?: number;
  maxFlake?: number;
  oracleAssertions?: string[];
}

export interface Verdict {
  pass: boolean;
  reasons: string[];
}

/** Compare a Score against a Baseline. */
export function judge(score: Score, base: Baseline): Verdict {
  const reasons: string[] = [];
  if (!score.green) reasons.push('suite not green');
  if (score.tests < base.minTests) reasons.push(`tests ${score.tests} < ${base.minTests}`);
  if (base.minCoverage !== undefined && score.coverage < base.minCoverage)
    reasons.push(`coverage ${score.coverage}% < ${base.minCoverage}%`);
  if (score.auditErrors > 0) reasons.push(`${score.auditErrors} audit error(s)`);
  const maxFlake = base.maxFlake ?? 0;
  if (score.flake > maxFlake) reasons.push(`flake ${score.flake} > ${maxFlake}`);
  if (score.oracleTotal > 0 && score.oracleHit < score.oracleTotal)
    reasons.push(`shadow-oracle ${score.oracleHit}/${score.oracleTotal}`);
  return { pass: reasons.length === 0, reasons };
}
