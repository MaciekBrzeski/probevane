import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sh } from '../../util/exec.js';
import type { RunResult, RunScope, CoverageResult } from '../adapter.js';

const REPORT = '.probevane-vitest.json';

/** Run vitest (unit) and/or playwright (e2e), parse to a RunResult. */
export async function runReact(dir: string, scope: RunScope, files?: string[]): Promise<RunResult> {
  const parts: RunResult[] = [];
  if (scope === 'unit' || scope === 'all') parts.push(await runVitest(dir, files));
  if (scope === 'e2e' || scope === 'all') parts.push(await runPlaywright(dir, files));
  return mergeResults(parts);
}

async function runVitest(dir: string, files?: string[]): Promise<RunResult> {
  const scoped = files?.length ? ' ' + files.map((f) => JSON.stringify(f)).join(' ') : '';
  const r = await sh(`npx vitest run --reporter=json --outputFile=${REPORT}${scoped}`, dir);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  try {
    const j = JSON.parse(await readFile(join(dir, REPORT), 'utf8'));
    passed = j.numPassedTests ?? 0;
    failed = j.numFailedTests ?? 0;
    skipped = (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0);
  } catch {
    // fall through: rely on exit code only
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

async function runPlaywright(dir: string, files?: string[]): Promise<RunResult> {
  const scoped = files?.length ? ' ' + files.filter((f) => /e2e|spec/.test(f)).map((f) => JSON.stringify(f)).join(' ') : '';
  const r = await sh(`npx playwright test --reporter=line${scoped}`, dir);
  // Playwright line reporter: "  N passed", "  N failed". Parse loosely.
  const passed = matchInt(r.stdout, /(\d+)\s+passed/);
  const failed = matchInt(r.stdout, /(\d+)\s+failed/) + matchInt(r.stderr, /(\d+)\s+failed/);
  const skipped = matchInt(r.stdout, /(\d+)\s+skipped/);
  const total = passed + failed + skipped;
  return {
    passed,
    failed,
    skipped,
    green: r.ok && failed === 0 && total > 0 && passed > 0,
    raw: (r.stdout + r.stderr).slice(-4000),
  };
}

function matchInt(s: string, re: RegExp): number {
  const m = s.match(re);
  return m ? parseInt(m[1], 10) : 0;
}

function mergeResults(parts: RunResult[]): RunResult {
  if (parts.length === 1) return parts[0];
  const passed = parts.reduce((a, p) => a + p.passed, 0);
  const failed = parts.reduce((a, p) => a + p.failed, 0);
  const skipped = parts.reduce((a, p) => a + p.skipped, 0);
  return {
    passed,
    failed,
    skipped,
    green: parts.every((p) => p.green),
    raw: parts.map((p) => p.raw).join('\n---\n'),
  };
}

/** vitest v8 coverage → coverage-summary.json. */
export async function coverageReact(dir: string): Promise<CoverageResult> {
  const r = await sh(
    `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text`,
    dir,
  );
  try {
    const j = JSON.parse(
      await readFile(join(dir, 'coverage', 'coverage-summary.json'), 'utf8'),
    );
    const t = j.total;
    return {
      statements: t.statements.pct,
      branches: t.branches.pct,
      functions: t.functions.pct,
      lines: t.lines.pct,
      ok: true,
      raw: r.stdout.slice(-2000),
    };
  } catch {
    return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false, raw: (r.stdout + r.stderr).slice(-2000) };
  }
}
