import type { RunResult, RunScope, CoverageResult } from '../adapter.js';
import { runVitest, runPlaywright, mergeResults, coverageVitest } from '../vitest-runner.js';

// Thin wiring to the shared vitest/playwright runners.
export async function runReact(dir: string, scope: RunScope, files?: string[]): Promise<RunResult> {
  const parts: RunResult[] = [];
  if (scope === 'unit' || scope === 'all') parts.push(await runVitest(dir, files));
  if (scope === 'e2e' || scope === 'all') parts.push(await runPlaywright(dir, files));
  return mergeResults(parts);
}

// Coverage comes from vitest alone — playwright adds nothing to line coverage.
export function coverageReact(dir: string): Promise<CoverageResult> {
  return coverageVitest(dir);
}
