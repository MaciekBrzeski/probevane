import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGaps } from '../src/coverage/gaps.js';
import { judge } from '../eval/scorer.js';
import { mergeResults } from '../src/adapters/vitest-runner.js';
import { auditSource } from '../src/audit/core.js';
import { jsAuditRules } from '../src/audit/rules-js.js';
import { goAuditRules } from '../src/audit/rules-go.js';
import { pyAuditRules } from '../src/audit/rules-py.js';
import { selectBest, scoreSuite, type SuiteScore } from '../src/loop/passk.js';
import { reactAdapter } from '../src/adapters/react-vitest-playwright/index.js';

describe('coverage.parseGaps', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gap-'));
    mkdirSync(join(dir, 'coverage'));
    const final = {
      '/p/src/a.ts': {
        path: join(dir, 'src/a.ts'),
        statementMap: { '0': { start: { line: 3 } }, '1': { start: { line: 7 } } },
        s: { '0': 0, '1': 2 },
        fnMap: { '0': { name: 'foo' } },
        f: { '0': 0 },
      },
    };
    writeFileSync(join(dir, 'coverage/coverage-final.json'), JSON.stringify(final));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reports uncovered lines + fns, skips covered', async () => {
    const gaps = await parseGaps(dir);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].uncoveredLines).toEqual([3]);
    expect(gaps[0].uncoveredFns).toEqual(['foo']);
  });
  it('returns [] when no report', async () => {
    expect(await parseGaps(mkdtempSync(join(tmpdir(), 'empty-')))).toEqual([]);
  });
});

describe('scorer.judge', () => {
  const base = { scope: 'unit' as const, minTests: 3, minCoverage: 80, maxFlake: 0, oracleAssertions: ['x', 'y'] };
  const ok = { green: true, tests: 5, failed: 0, skipped: 0, auditScore: 5, auditErrors: 0, coverage: 90, flake: 0, oracleHit: 2, oracleTotal: 2 };
  it('passes a good score', () => expect(judge(ok, base).pass).toBe(true));
  it('fails on low coverage', () => expect(judge({ ...ok, coverage: 70 }, base).pass).toBe(false));
  it('fails on too few tests', () => expect(judge({ ...ok, tests: 1 }, base).pass).toBe(false));
  it('fails on audit errors', () => expect(judge({ ...ok, auditErrors: 2 }, base).pass).toBe(false));
  it('fails on flake', () => expect(judge({ ...ok, flake: 0.3 }, base).pass).toBe(false));
  it('fails on shadow-oracle miss', () => expect(judge({ ...ok, oracleHit: 1 }, base).pass).toBe(false));
});

describe('vitest-runner.mergeResults', () => {
  it('sums parts + greens only if all green', () => {
    const m = mergeResults([
      { passed: 2, failed: 0, skipped: 0, green: true, raw: 'a' },
      { passed: 3, failed: 1, skipped: 0, green: false, raw: 'b' },
    ]);
    expect(m.passed).toBe(5);
    expect(m.failed).toBe(1);
    expect(m.green).toBe(false);
  });
});

describe('passk.selectBest (pass@k selection)', () => {
  const mk = (v: number): SuiteScore => ({ green: v >= 0, tests: 5, coverage: 80, auditScore: 5, auditErrors: 0, value: v });
  it('picks the highest-value candidate', () => {
    const best = selectBest([
      { label: 'a', score: mk(10), ref: 1 },
      { label: 'b', score: mk(42), ref: 2 },
      { label: 'c', score: mk(30), ref: 3 },
    ]);
    expect(best?.label).toBe('b');
  });
  it('returns null when all candidates are worthless', () => {
    expect(selectBest([{ label: 'x', score: mk(-1), ref: 0 }])).toBeNull();
  });
});

describe('passk.scoreSuite (real fixture)', () => {
  it('a green golden suite scores positive', async () => {
    const s = await scoreSuite('fixtures/react-todo', reactAdapter);
    expect(s.green).toBe(true);
    expect(s.value).toBeGreaterThan(0);
  }, 60_000);
});

describe('audit rules (js/go/py)', () => {
  it('js: conditional-expect + unused-import + waitForTimeout', () => {
    const src = `import { a, b } from './x';\nit('t', async () => { if (a) expect(1).toBe(1); await page.waitForTimeout(5); });`;
    const v = auditSource('a.test.ts', src, jsAuditRules()).map((x) => x.rule);
    expect(v).toContain('conditional-expect');
    expect(v).toContain('no-wait-for-timeout');
    expect(v).toContain('unused-import-in-test');
  });
  it('go: assertion-free + sleep', () => {
    const src = `func TestX(t *testing.T) {\n\ttime.Sleep(1)\n}`;
    const v = auditSource('x_test.go', src, goAuditRules()).map((x) => x.rule);
    expect(v).toContain('go-assert-in-test');
    expect(v).toContain('go-no-sleep');
  });
  it('py: assertion-free + skip', () => {
    const src = `@pytest.mark.skip\ndef test_x():\n    pass`;
    const v = auditSource('test_x.py', src, pyAuditRules()).map((x) => x.rule);
    expect(v).toContain('py-no-skip');
    expect(v).toContain('py-assert-in-test');
  });
});
