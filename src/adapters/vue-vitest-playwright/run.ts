import type { RunResult, RunScope, CoverageResult } from '../adapter.js';
import { runVitest, runPlaywright, mergeResults, coverageVitest } from '../vitest-runner.js';

// Scope-dispatch to the shared vitest/playwright runners, results merged.
export async function runVue(dir: string, scope: RunScope, files?: string[]): Promise<RunResult> {
  const parts: RunResult[] = [];
  if (scope === 'unit' || scope === 'all') parts.push(await runVitest(dir, files));
  if (scope === 'e2e' || scope === 'all') parts.push(await runPlaywright(dir, files));
  return mergeResults(parts);
}

// Coverage comes from vitest alone (same as React).
export function coverageVue(dir: string): Promise<CoverageResult> {
  return coverageVitest(dir);
}
