import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pythonAdapter } from '../src/adapters/python-pytest/index.js';
import type { RunScope } from '../src/adapters/adapter.js';

// --- temp dir bookkeeping (same helpers as cov-mut-adapters.test.ts) -------
const dirs: string[] = [];
function tmp(prefix = 'pv-covmut-py-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function write(dir: string, rel: string, contents: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

// A <testsuite> opening tag is all run() parses (via /<testsuite\b[^>]*>/).
function suite(a: { tests: number; failures: number; errors: number; skipped: number }): string {
  return `<testsuite name="pytest" tests="${a.tests}" failures="${a.failures}" errors="${a.errors}" skipped="${a.skipped}">\n</testsuite>\n`;
}

// Mock `sh` as a no-op returning a canned ShResult, then dynamic-import the
// adapter so it picks up the mock. run()/coverage() then parse ONLY the result
// file we pre-wrote (mocked sh never spawns pytest, so it can't overwrite it).
async function withSh(res: { ok: boolean; code?: number; stdout?: string; stderr?: string }) {
  vi.resetModules();
  vi.doMock('../src/util/exec.js', () => ({
    sh: async () => ({ ok: res.ok, code: res.code ?? (res.ok ? 0 : 1), stdout: res.stdout ?? '', stderr: res.stderr ?? '' }),
    capOutput: (s: string) => s,
  }));
  return (await import('../src/adapters/python-pytest/index.js')).pythonAdapter;
}

// =========================================================================
// run() — JUnit-XML count parsing + green predicate
// index.ts:109 failed = attr('failures') + attr('errors')      (+ → -)
// index.ts:115 const total = passed + failed + skipped         (+ → -)
// index.ts:120 green: r.ok && failed===0 && total>0 && passed>0 (=== → !==, && → ||)
// index.ts:121 raw: (r.stdout + r.stderr).slice(-4000)         (+ → -)
// =========================================================================
describe('pythonAdapter.run — count + green mutants', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/util/exec.js');
  });

  // index.ts:109 — failed sums BOTH failures AND errors.
  it('failed = failures + errors when both are non-zero (kills + → -)', async () => {
    const py = await withSh({ ok: true });
    const d = tmp();
    write(d, '.probevane-pytest.xml', suite({ tests: 10, failures: 2, errors: 3, skipped: 1 }));
    const r = await py.run(d, 'all' as RunScope);
    expect(r.failed).toBe(5); // 2 + 3; mutant `2 - 3` = -1
    expect(r.passed).toBe(4); // tests(10) - failed(5) - skipped(1)
    expect(r.skipped).toBe(1);
  });

  // index.ts:115 — total counts skipped POSITIVELY. Only observable via
  // green's `total > 0`, which requires failed===0 (else green is already
  // false). With failed===0 the FIRST `+` (passed - failed) is unchanged, so
  // only the skipped-subtraction mutant is killable here; passed(1) - skipped(2)
  // = -1 flips green to false.
  it('total adds skipped so green stays true (kills passed+failed - skipped)', async () => {
    const py = await withSh({ ok: true });
    const d = tmp();
    write(d, '.probevane-pytest.xml', suite({ tests: 3, failures: 0, errors: 0, skipped: 2 }));
    const r = await py.run(d, 'all' as RunScope);
    expect(r.passed).toBe(1); // 3 - 0 - 2
    expect(r.skipped).toBe(2);
    expect(r.green).toBe(true); // total = 1+0+2 = 3 > 0; mutant `1+0-2` = -1 → green false
  });

  // index.ts:120 — all-pass suite is green. failed===0 → true; mutant !== flips it.
  it('all-pass suite is green (kills === → !== and pins the true row)', async () => {
    const py = await withSh({ ok: true });
    const d = tmp();
    write(d, '.probevane-pytest.xml', suite({ tests: 3, failures: 0, errors: 0, skipped: 0 }));
    const r = await py.run(d, 'all' as RunScope);
    expect(r.passed).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.green).toBe(true); // mutant `failed !== 0` → false → green false
  });

  // index.ts:120 — a failing suite is NOT green, even with passes present.
  // Kills === → !== (mutant would report green) and && #2/#3 → || (the OR
  // shortcuts past the failure via total>0 && passed>0).
  it('a suite with failures is not green (kills === → !== and && → ||)', async () => {
    const py = await withSh({ ok: true });
    const d = tmp();
    write(d, '.probevane-pytest.xml', suite({ tests: 3, failures: 1, errors: 1, skipped: 0 }));
    const r = await py.run(d, 'all' as RunScope);
    expect(r.failed).toBe(2);
    expect(r.passed).toBe(1);
    expect(r.green).toBe(false); // failed===0 is false → green false; mutants flip it
  });

  // index.ts:120 — an empty suite (0 tests) is not green even with r.ok.
  // Kills && #2 → || : `(r.ok && failed===0) || (total>0 && passed>0)` = true → green.
  it('an empty (0-test) suite is not green (kills a middle && → ||)', async () => {
    const py = await withSh({ ok: true });
    const d = tmp();
    write(d, '.probevane-pytest.xml', suite({ tests: 0, failures: 0, errors: 0, skipped: 0 }));
    const r = await py.run(d, 'all' as RunScope);
    expect(r.passed).toBe(0);
    expect(r.green).toBe(false); // total 0 & passed 0; mutant OR shortcuts to true
  });

  // index.ts:120 — r.ok false ⇒ not green even for a clean report.
  // Kills the FIRST && → || : `r.ok || (failed===0 && total>0 && passed>0)` = true.
  // index.ts:121 — raw carries BOTH stdout and stderr (kills + → -, which
  // yields NaN and NaN.slice throws; raw IS exposed on RunResult so observable).
  it('r.ok false is not green + raw concatenates stdout & stderr (kills first && → || and raw + → -)', async () => {
    const py = await withSh({ ok: false, stdout: 'RUNOUT', stderr: 'RUNERR' });
    const d = tmp();
    write(d, '.probevane-pytest.xml', suite({ tests: 3, failures: 0, errors: 0, skipped: 0 }));
    const r = await py.run(d, 'all' as RunScope);
    expect(r.passed).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.green).toBe(false); // r.ok false; mutant `r.ok || ...` → true
    expect(r.raw).toContain('RUNOUT'); // mutant `stdout - stderr` = NaN → throws
    expect(r.raw).toContain('RUNERR');
  });
});

// =========================================================================
// coverage() — success/error branches
// index.ts:136 ok: true   (success stub)                    (true → false)
// index.ts:140 ok: false + raw:(r.stdout + r.stderr).slice  (true→false / + → -)
// =========================================================================
describe('pythonAdapter.coverage — ok flag + error raw', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/util/exec.js');
  });

  // index.ts:136 — a parseable coverage.json yields ok:true.
  it('a successful coverage read reports ok:true (kills true → false)', async () => {
    const py = await withSh({ ok: true, stdout: 'COV' });
    const d = tmp();
    write(d, 'coverage.json', JSON.stringify({ totals: { percent_covered: 87.5 } }));
    const r = await py.coverage(d);
    expect(r.ok).toBe(true); // mutant → false
    expect(r.statements).toBe(87.5);
    expect(r.lines).toBe(87.5);
  });

  // index.ts:140 — missing coverage.json drives the catch: ok:false, and raw
  // concatenates stdout+stderr.
  it('a failed coverage read reports ok:false with stdout+stderr in raw (kills true→false and + → -)', async () => {
    const py = await withSh({ ok: false, stdout: 'COUT', stderr: 'CERR' });
    const d = tmp(); // no coverage.json → JSON.parse throws → catch branch
    const r = await py.coverage(d);
    expect(r.ok).toBe(false); // mutant → true
    expect(r.raw).toContain('COUT'); // mutant `stdout - stderr` = NaN → throws
    expect(r.raw).toContain('CERR');
  });
});

// =========================================================================
// specFiles() — test-file filter regex
// index.ts:146 files.filter(f => /(^|\/)test_\w+\.py$/.test(f) || /_test\.py$/.test(f))
//   The `+` is the `\w+` quantifier; `+ → -` corrupts it to `\w-`, so
//   `test_foo.py` (no literal dash) no longer matches the first alternative.
// Uses the real fs walk — no sh needed, so the un-mocked top-level import.
// =========================================================================
describe('pythonAdapter.specFiles — test-file filter (kills \\w+ → \\w-)', () => {
  it('keeps test_foo.py and bar_test.py, drops non-test .py', async () => {
    const d = tmp();
    write(d, 'test_foo.py', 'def test_x():\n    assert True\n');
    write(d, 'bar_test.py', 'def test_y():\n    assert True\n');
    write(d, 'helper.py', 'def helper():\n    return 1\n');
    const files = await pythonAdapter.specFiles(d);
    expect(files).toContain('test_foo.py'); // mutant `\w-` drops this (no dash)
    expect(files).toContain('bar_test.py'); // matched by the second regex, unaffected
    expect(files).not.toContain('helper.py');
  });
});
