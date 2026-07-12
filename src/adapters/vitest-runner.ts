import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sh } from '../util/exec.js';
import type { RunResult, CoverageResult } from './adapter.js';
import { readCoverageSummary } from './coverage-summary.js';

// Shared vitest + playwright runners for every vitest-based stack (React, Vue,
// Svelte). One implementation instead of three copies — the adapters just wire
// run()/coverage() to these.

const REPORT = '.probevane-vitest.json';

// Run vitest with a JSON report FILE (not stdout) so counts survive custom
// reporters and noisy output; `files` scopes the run to just-written specs.
export async function runVitest(dir: string, files?: string[]): Promise<RunResult> {
  const scoped = files?.length ? ' ' + files.map((f) => JSON.stringify(f)).join(' ') : '';
  const r = await sh(`npx vitest run --reporter=json --outputFile=${REPORT}${scoped}`, dir);
  let passed = 0, failed = 0, skipped = 0;
  try {
    const j = JSON.parse(await readFile(join(dir, REPORT), 'utf8'));
    passed = j.numPassedTests ?? 0;
    failed = j.numFailedTests ?? 0;
    skipped = (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0);
  } catch {
    failed = r.ok ? failed : Math.max(failed, 1);
  }
  const total = passed + failed + skipped;
  return {
    passed,
    failed,
    skipped,
    green: r.ok && failed === 0 && total > 0 && passed > 0,
    raw: (r.stdout + r.stderr).slice(-4000),
  };
}

// Run playwright and parse the line reporter for counts; scoping keeps only
// e2e-ish paths so unit specs never leak into the browser run.
export async function runPlaywright(dir: string, files?: string[]): Promise<RunResult> {
  const scoped = files?.length
    ? ' ' + files.filter((f) => /e2e|spec/.test(f)).map((f) => JSON.stringify(f)).join(' ')
    : '';
  const r = await sh(`npx playwright test --reporter=line${scoped}`, dir);
  const n = (re: RegExp, s: string) => (s.match(re) ? parseInt(s.match(re)![1], 10) : 0);
  const passed = n(/(\d+)\s+passed/, r.stdout);
  const failed = n(/(\d+)\s+failed/, r.stdout) + n(/(\d+)\s+failed/, r.stderr);
  const skipped = n(/(\d+)\s+skipped/, r.stdout);
  const total = passed + failed + skipped;
  return {
    passed,
    failed,
    skipped,
    green: r.ok && failed === 0 && total > 0 && passed > 0,
    raw: (r.stdout + r.stderr).slice(-4000),
  };
}

// Fold unit + e2e results into one: sums for counts, green only if every part is.
export function mergeResults(parts: RunResult[]): RunResult {
  if (parts.length === 1) return parts[0];
  return {
    passed: parts.reduce((a, p) => a + p.passed, 0),
    failed: parts.reduce((a, p) => a + p.failed, 0),
    skipped: parts.reduce((a, p) => a + p.skipped, 0),
    green: parts.every((p) => p.green),
    raw: parts.map((p) => p.raw).join('\n---\n'),
  };
}

// Coverage via v8: json-summary feeds the gate, text lands in `raw` for humans.
export async function coverageVitest(dir: string): Promise<CoverageResult> {
  const r = await sh(
    `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`,
    dir,
  );
  const c = await readCoverageSummary(dir);
  return c.ok
    ? { ...c, raw: r.stdout.slice(-2000) }
    : { ...c, raw: (r.stdout + r.stderr).slice(-2000) };
}
