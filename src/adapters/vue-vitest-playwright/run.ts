import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sh } from '../../util/exec.js';
import type { RunResult, RunScope, CoverageResult } from '../adapter.js';

// vitest + playwright runners — same machinery as the React adapter (any
// vitest/playwright stack), kept local to this adapter so adding Vue touched
// no shared/core code.
const REPORT = '.probevane-vitest.json';

export async function runVue(dir: string, scope: RunScope, files?: string[]): Promise<RunResult> {
  const parts: RunResult[] = [];
  if (scope === 'unit' || scope === 'all') parts.push(await runVitest(dir, files));
  if (scope === 'e2e' || scope === 'all') parts.push(await runPlaywright(dir));
  return parts.length === 1 ? parts[0] : merge(parts);
}

async function runVitest(dir: string, files?: string[]): Promise<RunResult> {
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

async function runPlaywright(dir: string): Promise<RunResult> {
  const r = await sh(`npx playwright test --reporter=line`, dir);
  const n = (re: RegExp, s: string) => (s.match(re) ? parseInt(s.match(re)![1], 10) : 0);
  const passed = n(/(\d+)\s+passed/, r.stdout);
  const failed = n(/(\d+)\s+failed/, r.stdout) + n(/(\d+)\s+failed/, r.stderr);
  const skipped = n(/(\d+)\s+skipped/, r.stdout);
  const total = passed + failed + skipped;
  return { passed, failed, skipped, green: r.ok && failed === 0 && total > 0 && passed > 0, raw: (r.stdout + r.stderr).slice(-4000) };
}

function merge(parts: RunResult[]): RunResult {
  return {
    passed: parts.reduce((a, p) => a + p.passed, 0),
    failed: parts.reduce((a, p) => a + p.failed, 0),
    skipped: parts.reduce((a, p) => a + p.skipped, 0),
    green: parts.every((p) => p.green),
    raw: parts.map((p) => p.raw).join('\n---\n'),
  };
}

export async function coverageVue(dir: string): Promise<CoverageResult> {
  const r = await sh(`npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text`, dir);
  try {
    const j = JSON.parse(await readFile(join(dir, 'coverage', 'coverage-summary.json'), 'utf8'));
    const t = j.total;
    return { statements: t.statements.pct, branches: t.branches.pct, functions: t.functions.pct, lines: t.lines.pct, ok: true, raw: r.stdout.slice(-2000) };
  } catch {
    return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false, raw: (r.stdout + r.stderr).slice(-2000) };
  }
}
