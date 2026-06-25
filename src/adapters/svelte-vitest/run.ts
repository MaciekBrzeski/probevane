import type { RunResult, RunScope, CoverageResult } from '../adapter.js';
import { runVitest, coverageVitest } from '../vitest-runner.js';

export function runSvelte(dir: string, _scope: RunScope, files?: string[]): Promise<RunResult> {
  return runVitest(dir, files);
}

export function coverageSvelte(dir: string): Promise<CoverageResult> {
  return coverageVitest(dir);
}
