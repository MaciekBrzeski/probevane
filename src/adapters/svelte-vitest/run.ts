import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sh } from '../../util/exec.js';
import type { RunResult, RunScope, CoverageResult } from '../adapter.js';

// vitest runner (same machinery as the React/Vue adapters), kept local so adding
// Svelte touched no shared/core code.
const REPORT = '.probevane-vitest.json';

export async function runSvelte(dir: string, _scope: RunScope, files?: string[]): Promise<RunResult> {
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
  return { passed, failed, skipped, green: r.ok && failed === 0 && total > 0 && passed > 0, raw: (r.stdout + r.stderr).slice(-4000) };
}

export async function coverageSvelte(dir: string): Promise<CoverageResult> {
  const r = await sh(`npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`, dir);
  try {
    const j = JSON.parse(await readFile(join(dir, 'coverage', 'coverage-summary.json'), 'utf8'));
    const t = j.total;
    return { statements: t.statements.pct, branches: t.branches.pct, functions: t.functions.pct, lines: t.lines.pct, ok: true, raw: r.stdout.slice(-2000) };
  } catch {
    return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false, raw: (r.stdout + r.stderr).slice(-2000) };
  }
}
