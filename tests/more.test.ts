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
import { recordingBrain, replayBrain } from '../src/brain/replay.js';
import { groundFindings, parseVerdicts } from '../src/review/verify.js';
import { parseFindings } from '../src/review/diff-review.js';

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

describe('review verification gate', () => {
  it('parseFindings extracts findings from chatty text', () => {
    const f = parseFindings('sure: [{"file":"a.ts","line":3,"severity":"error","issue":"bug","fix":"x"}]');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('error');
  });
  it('groundFindings drops references to nonexistent files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gf-'));
    writeFileSync(join(dir, 'real.ts'), 'line1\nline2\nline3\n');
    const grounded = await groundFindings(dir, [
      { file: 'real.ts', line: 2, severity: 'error', issue: 'x', fix: '' },
      { file: 'ghost.ts', line: 1, severity: 'error', issue: 'hallucinated', fix: '' },
      { file: 'real.ts', line: 999, severity: 'warn', issue: 'out of range', fix: '' },
    ]);
    expect(grounded.map((f) => f.file)).toEqual(['real.ts']);
    expect(grounded[0].line).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });
  it('parseVerdicts maps index→real', () => {
    const v = parseVerdicts('[{"index":0,"real":true,"reason":"yes"},{"index":1,"real":false}]');
    expect(v.get(0)).toBe(true);
    expect(v.get(1)).toBe(false);
  });
});

describe('brain replay (record → replay identical, offline)', () => {
  it('replays a recorded response and errors on a miss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cass-'));
    const cassette = join(dir, 'c.jsonl');
    const fake = { id: 'fake', model: 'fake', async complete() { return { text: 'hi', toolCalls: [], stopReason: 'end_turn' as const, usage: { input: 1, output: 1 } }; } };
    const rec = recordingBrain(fake, cassette);
    const req = { system: 'S', messages: [{ role: 'user' as const, text: 'q' }], tools: [] };
    const live = await rec.complete(req);
    const replayed = await replayBrain(cassette).complete(req);
    expect(replayed).toEqual(live);
    await expect(replayBrain(cassette).complete({ ...req, system: 'OTHER' })).rejects.toThrow(/no cassette/);
    rmSync(dir, { recursive: true, force: true });
  });
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
