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
import { a11yRules } from '../src/a11y/rules.js';
import { buildExamples, splitExamples, statsByStack } from '../src/distill/dataset.js';
import type { Trace } from '../src/distill/collect.js';
import { stripFences, baseValue } from '../src/distill/bases.js';
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

describe('distillation dataset', () => {
  const mk = (stack: string, spec: string, task = 't'): Trace => ({ ts: '2026-01-01', stack, task, specPath: 'a.test.ts', spec });
  it('filters low-quality + dedups, builds chat examples', () => {
    const traces = [
      mk('react', `import x; it('t', () => { expect(add(1,2)).toBe(3); });`),
      mk('react', `import x; it('t', () => { expect(add(1,2)).toBe(3); });`), // dup
      mk('go', 'short'), // too short + no assertion → filtered
    ];
    const ex = buildExamples(traces);
    expect(ex).toHaveLength(1);
    expect(ex[0].messages[0].role).toBe('system');
    expect(ex[0].messages[2].content).toContain('expect');
  });
  it('splits 90/10 deterministically', () => {
    const ex = Array.from({ length: 20 }, (_, i) => ({ messages: [{ role: 'user' as const, content: `e${i}` }] }));
    const { train, val } = splitExamples(ex);
    expect(train).toHaveLength(18);
    expect(val).toHaveLength(2);
  });
  it('counts by stack', () => {
    expect(statsByStack([mk('react', 'a'), mk('react', 'b'), mk('go', 'c')])).toEqual({ react: 2, go: 1 });
  });
  const longSpec = `import { it, expect } from 'vitest';\nit('adds two numbers', () => { expect(add(1,2)).toBe(3); });`;
  it('threads gate-feedback into the training prompt when present', () => {
    const withGates: Trace = { ...mk('react', longSpec), gateBlocks: ['audit_gate: conditional-expect', 'validation_gate: unit tests not green'] };
    const ex = buildExamples([withGates]);
    expect(ex[0].messages[1].content).toContain('avoid these');
    expect(ex[0].messages[1].content).toContain('conditional-expect');
  });
  it('omits the constraint line when no gate blocks', () => {
    expect(buildExamples([mk('react', longSpec)])[0].messages[1].content).not.toContain('avoid these');
  });
});

describe('cpu base bake-off helpers', () => {
  it('stripFences pulls code out of a fenced block', () => {
    expect(stripFences('blah\n```go\nfunc T(){}\n```\nend')).toBe('func T(){}');
    expect(stripFences('no fence here')).toBe('no fence here');
  });
  it('baseValue gates on green, rewards coverage+tests, penalizes audit', () => {
    expect(baseValue({ green: false, tests: 9, coverage: 100, auditErrors: 0 })).toBe(-1);
    expect(baseValue({ green: true, tests: 4, coverage: 100, auditErrors: 0 })).toBe(120);
    expect(baseValue({ green: true, tests: 4, coverage: 100, auditErrors: 1 })).toBe(110);
  });
});

describe('visual_gate decision', () => {
  it('blocks an e2e spec with no screenshot, allows one with checkpoint', async () => {
    const { visualGate } = await import('../src/loop/runes/visual_gate.js');
    const dir = mkdtempSync(join(tmpdir(), 'vg-'));
    mkdirSync(join(dir, 'e2e'), { recursive: true });
    const mk = (body: string) => {
      writeFileSync(join(dir, 'e2e', 'a.spec.ts'), body);
      return { workdir: dir, editedFiles: new Set(['e2e/a.spec.ts']), adapter: { id: 'react-vitest-playwright' } } as any;
    };
    const noShot = await visualGate.shouldStop!(mk(`test('t', async ({page}) => { await page.goto('/'); });`));
    expect(noShot.kind).toBe('block');
    const withShot = await visualGate.shouldStop!(mk(`import {checkpoint} from './checkpoint'; test('t', async ({page}) => { await page.goto('/'); await checkpoint(page,'x'); });`));
    expect(withShot.kind).toBe('allow');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('cost ledger', () => {
  it('costOf prices haiku/sonnet + cache reads', async () => {
    const { costOf } = await import('../src/cost/pricing.js');
    expect(costOf('claude-haiku-4-5-20251001', { input: 100_000, output: 10_000 })).toBeCloseTo(0.15, 6);
    expect(costOf('claude-sonnet-4-6', { input: 100_000, output: 10_000 })).toBeCloseTo(0.45, 6);
    expect(costOf('claude-haiku-4-5', { input: 0, output: 0, cacheRead: 50_000 })).toBeCloseTo(0.005, 6);
    expect(costOf('local:qwen', { input: 1_000_000, output: 1_000_000 })).toBe(0); // local is free
  });
  it('summarize splits harness-alone vs takeover vs hand', async () => {
    const { summarize } = await import('../src/cost/ledger.js');
    const r = (o: any) => ({ ts: 't', runId: 'x', label: 'generate:a', model: 'claude-haiku-4-5', tokensIn: 0, tokensOut: 0, cacheRead: 0, cost: 0.1, stopReason: 's', steps: 1, ...o });
    const s = summarize([r({ accepted: true, tookOver: false }), r({ accepted: true, tookOver: true }), r({ accepted: false, tookOver: false })]);
    expect(s.harnessOnly).toBe(1);
    expect(s.withTakeover).toBe(1);
    expect(s.needsHand).toBe(1);
    expect(s.acceptRate).toBe(0.667);
    expect(s.byPath.generate.runs).toBe(3);
  });
});

describe('loop peek view-model', () => {
  it('collapses events to the latest per run', async () => {
    const { latestPerRun } = await import('../src/loop/observe.js');
    const ev = (runId: string, step: number, extra = {}) => ({ ts: 't', runId, step, toolCalls: step, gateBlocks: 0, tokensIn: 0, tokensOut: 0, ...extra });
    const m = latestPerRun([ev('a', 1), ev('a', 2), ev('b', 1), ev('a', 3, { stopReason: 'accepted', accepted: true })] as any);
    expect(m.get('a')!.step).toBe(3);
    expect(m.get('a')!.accepted).toBe(true);
    expect(m.get('b')!.step).toBe(1);
  });
});

describe('a11y rules', () => {
  it('catches missing alt / name / role / positive tabindex', () => {
    const bad = `export function B(){return(<div>\n<img src="x"/>\n<div onClick={()=>{}}>x</div>\n<input type="text"/>\n<button tabIndex={3}></button>\n</div>);}`;
    const ids = a11yRules().flatMap((r) => auditSource('B.tsx', bad, [r])).map((v) => v.rule);
    expect(ids).toContain('a11y-img-alt');
    expect(ids).toContain('a11y-click-no-role');
    expect(ids).toContain('a11y-input-label');
    expect(ids).toContain('a11y-positive-tabindex');
  });
  it('passes a multiline labeled input (no false positive)', () => {
    const ok = `<input\n  aria-label="Name"\n  value={v}\n/>`;
    const v = auditSource('ok.tsx', ok, a11yRules());
    expect(v.find((x) => x.rule === 'a11y-input-label')).toBeUndefined();
  });
  it('img with alt passes', () => {
    const v = auditSource('ok.tsx', `<img src="x" alt="a cat" />`, a11yRules());
    expect(v.find((x) => x.rule === 'a11y-img-alt')).toBeUndefined();
  });
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

describe('visual improve — extractFence', () => {
  it('pulls the code out of a fenced reply, null when none', async () => {
    const { extractFence } = await import('../src/visual/improve.js');
    expect(extractFence('here:\n```html\n<h1>x</h1>\n```\ndone')).toBe('<h1>x</h1>');
    expect(extractFence('DONE')).toBeNull();
  });
});

describe('validation_gate tsc error counting', () => {
  it('counts error TS diagnostics (so a dirty baseline cannot mask new errors)', async () => {
    const { countTsErrors } = await import('../src/loop/runes/validation_gate.js');
    expect(countTsErrors('all good')).toBe(0);
    expect(countTsErrors('x.ts(14,20): error TS2554: Expected 1 arguments, but got 0.')).toBe(1);
    expect(countTsErrors('a error TS1\nb error TS2554\nnote: not an error')).toBe(2);
  });
});

describe('playwright-test-import audit rule', () => {
  it('flags bare playwright/test, allows @playwright/test', () => {
    // probevane-allow: playwright-test-import — fixture string, not a real call
    const bad = auditSource('e2e/a.spec.ts', `import { test } from 'playwright/test';`, jsAuditRules());
    expect(bad.map((v) => v.rule)).toContain('playwright-test-import');
    const ok = auditSource('e2e/a.spec.ts', `import { test } from '@playwright/test';`, jsAuditRules());
    expect(ok.map((v) => v.rule)).not.toContain('playwright-test-import');
  });
});

describe('audit rules (js/go/py)', () => {
  it('js: conditional-expect + unused-import + brittle-wait', () => {
    // probevane-allow: no-wait-for-timeout probevane-allow: conditional-expect (intentional bad-code fixture)
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
