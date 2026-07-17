import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- env MUST be set before the library modules (which capture LIB_ROOT at
// import time) are dynamically imported below. Pure modules are static imports;
// none of them transitively load library/store, so this ordering is safe.
const LIB_DIR = mkdtempSync(join(tmpdir(), 'pv-cov-lib-'));
process.env.PROBEVANE_LIB = LIB_DIR;
process.env.PROBEVANE_STATE = LIB_DIR; // recordAudit writes audit.jsonl under here

// Pure / env-free modules — static import.
import { appendLog, readLog, LOG_COLUMNS } from '../src/library/improvement-log.js';
import { loadPrompt } from '../src/library/prompt.js';
import { factDigest } from '../src/loop/fact-digest.js';
import { scoreSuite, selectBest, type SuiteScore, type Candidate } from '../src/loop/passk.js';
import { routeModels, assessComplexity } from '../src/loop/complexity.js';
import {
  nudgeCheck,
  fatalCheck,
  neverEditedCheck,
  consultCheck,
  difficultyCheck,
  stuckCheck,
  budgetCheck,
} from '../src/loop/engine/escalation.js';
import { RunCtx } from '../src/loop/ctx.js';
import type { LoopRun, LoopState } from '../src/loop/engine/phases.js';
import type { RunOptions } from '../src/loop/engine/index.js';
import type { Msg, BrainResponse } from '../src/loop/types.js';
import type { StackAdapter } from '../src/adapters/adapter.js';

// Library modules captured LIB_ROOT from the env above — dynamic import now.
const store = await import('../src/library/store.js');
const retrieve = await import('../src/library/retrieve.js');
const caveats = await import('../src/library/caveats.js');

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-8';

// ---------------------------------------------------------------------------
// improvement-log.ts
// ---------------------------------------------------------------------------
describe('improvement-log', () => {
  let dir: string;
  let logPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pv-log-'));
    logPath = join(dir, 'nested', 'improvement-log.csv');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appendLog writes header on first append, none on the second', async () => {
    await appendLog(logPath, { target: 'a', kind: 'unit', pass: 1 });
    await appendLog(logPath, { target: 'b', kind: 'e2e', pass: 0 });
    const txt = await readFile(logPath, 'utf8');
    const lines = txt.trim().split('\n');
    expect(lines[0]).toBe(LOG_COLUMNS.join(','));
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain('a');
    expect(lines[2]).toContain('b');
  });

  it('csv() quotes values with commas/quotes/newlines and blanks undefined', async () => {
    await appendLog(logPath, { target: 'x,y', note: 'he said "hi"', tests: 3 });
    const txt = await readFile(logPath, 'utf8');
    expect(txt).toContain('"x,y"');
    expect(txt).toContain('"he said ""hi"""');
    // undefined columns => empty cells (no crash). readLog uses a naive split,
    // so a quoted comma intentionally shifts cells — just assert it parses.
    const rows = await readLog(logPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].timestamp).toBe('');
  });

  it('readLog returns [] for a missing/empty file', async () => {
    expect(await readLog(join(dir, 'nope.csv'))).toEqual([]);
  });

  it('readLog maps columns to objects and pads short rows', async () => {
    await appendLog(logPath, { target: 't1', audit_score: 5 });
    const rows = await readLog(logPath);
    expect(rows[0].target).toBe('t1');
    expect(rows[0].audit_score).toBe('5');
    // unset columns become '' (the `?? ''` branch)
    expect(rows[0].coverage).toBe('');
  });

  it('appendLog to an old-schema file appends a NEW header line, never rewrites', async () => {
    const oldHeader = 'timestamp,target,kind,pass,audit_score,tests,coverage,flake,library_good,library_bad,note';
    const oldRow = '2026-06-24T00:00:00.000Z,react-todo,unit,1,5,2,92.85,0,,,ci-baseline';
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(logPath, oldHeader + '\n' + oldRow + '\n');

    await appendLog(logPath, { target: 'py-calc', mutation: 0.8, cost_usd: 0.12 });
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    // old era untouched, new header inserted before the new row
    expect(lines[0]).toBe(oldHeader);
    expect(lines[1]).toBe(oldRow);
    expect(lines[2]).toBe(LOG_COLUMNS.join(','));
    expect(lines[3]).toContain('py-calc');
    // a further append reuses the current header (no duplicate)
    await appendLog(logPath, { target: 'vue-counter' });
    const again = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(again.filter((l) => l.startsWith('timestamp,'))).toHaveLength(2);
  });

  it('readLog parses each era with its own schema', async () => {
    const oldHeader = 'timestamp,target,kind,pass,audit_score,tests,coverage,flake,library_good,library_bad,note';
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(logPath, oldHeader + '\n' + 'ts1,react-todo,unit,1,5,2,92.85,0,,,old-note\n');
    await appendLog(logPath, { timestamp: 'ts2', target: 'py-calc', mutation: 0.8, tokens_in: 1200 });

    const rows = await readLog(logPath);
    expect(rows).toHaveLength(2);
    expect(rows[0].target).toBe('react-todo');
    expect(rows[0].note).toBe('old-note');
    expect(rows[0].mutation).toBeUndefined(); // old era has no such column
    expect(rows[1].target).toBe('py-calc');
    expect(rows[1].mutation).toBe('0.8');
    expect(rows[1].tokens_in).toBe('1200');
  });
});

// ---------------------------------------------------------------------------
// prompt.ts
// ---------------------------------------------------------------------------
describe('prompt.loadPrompt', () => {
  it('loads an existing prompt file', async () => {
    const txt = await loadPrompt('unit-patterns.md');
    expect(txt.length).toBeGreaterThan(0);
  });
  it('returns "" for a missing prompt file', async () => {
    expect(await loadPrompt('definitely-missing-xyz.md')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// store.ts + retrieve.ts + caveats.ts  (share LIB_DIR)
// ---------------------------------------------------------------------------
describe('library store/retrieve/caveats', () => {
  function meta(over: Partial<store.ExampleMeta> = {}): store.ExampleMeta {
    return {
      slug: 'ex',
      stack: 'react-vitest-playwright',
      kind: 'unit',
      category: 'pure-helpers',
      quality: 'good',
      savedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    };
  }

  it('libraryExists is false (catch) when the lib root is absent', async () => {
    rmSync(LIB_DIR, { recursive: true, force: true });
    expect(await store.libraryExists()).toBe(false);
    mkdirSync(LIB_DIR, { recursive: true }); // restore for following tests
  });

  it('libraryExists is false when the dir exists but has no index', async () => {
    expect(await store.libraryExists()).toBe(false);
  });

  it('saveExample writes md + meta.json + index row and returns the md path', async () => {
    const rel = await store.saveExample(meta({ slug: 'helper-1', score: 4 }), '// a passing test\n');
    expect(rel).toContain('helper-1.md');
    const md = await store.readExample(rel);
    expect(md).toContain('passing test');
    const metaTxt = await readFile(join(LIB_DIR, rel.replace('.md', '.meta.json')), 'utf8');
    expect(JSON.parse(metaTxt).slug).toBe('helper-1');
    const idx = await store.readIndex();
    expect(idx.some((r) => r.slug === 'helper-1' && r.path === rel)).toBe(true);
  });

  it('libraryExists is true once an index exists', async () => {
    expect(await store.libraryExists()).toBe(true);
  });

  it('readExample returns "" for a missing relative path (catch)', async () => {
    expect(await store.readExample('good/none/none/missing.md')).toBe('');
  });

  it('retrieveFewShot filters by stack+kind+quality, ranks category>score>recency, slices topK', async () => {
    // good, matching, high score, matching category
    await store.saveExample(meta({ slug: 'g-cat-hi', score: 9, category: 'pure-helpers' }), '// G CAT HI');
    // good, matching, higher score but WRONG category
    await store.saveExample(meta({ slug: 'g-nocat-higher', score: 10, category: 'component-crud' }), '// G NOCAT');
    // good, matching category, lower score, newer savedAt (recency tiebreak)
    await store.saveExample(
      meta({ slug: 'g-cat-lo-new', score: 9, category: 'pure-helpers', savedAt: '2026-02-02T00:00:00.000Z' }),
      '// G CAT LO NEW',
    );
    // bad quality (excluded)
    await store.saveExample(meta({ slug: 'bad-one', quality: 'bad', score: 99 }), '// BAD');
    // wrong stack (excluded)
    await store.saveExample(meta({ slug: 'vue-one', stack: 'vue-vitest', score: 99 }), '// VUE');
    // wrong kind (excluded)
    await store.saveExample(meta({ slug: 'e2e-one', kind: 'e2e', score: 99 }), '// E2E');

    const res = await retrieve.retrieveFewShot({
      stack: 'react-vitest-playwright',
      kind: 'unit',
      category: 'pure-helpers',
      topK: 2,
    });
    expect(res).toHaveLength(2);
    // category-match wins over the higher-score wrong-category example
    expect(res.map((r) => r.meta.slug)).not.toContain('g-nocat-higher');
    // both picked are category matches; equal score => newest first
    expect(res[0].meta.slug).toBe('g-cat-lo-new');
    expect(res[1].meta.slug).toBe('g-cat-hi');
    expect(res[0].body).toContain('G CAT LO NEW');
    // excluded ones never appear
    const slugs = res.map((r) => r.meta.slug);
    expect(slugs).not.toContain('bad-one');
    expect(slugs).not.toContain('vue-one');
    expect(slugs).not.toContain('e2e-one');
  });

  it('retrieveFewShot defaults topK=3 and skips rows whose body is empty', async () => {
    // an index row pointing at a non-existent md => readExample "" => skipped
    const { appendJsonl } = await import('../src/util/jsonl.js');
    await appendJsonl(join(LIB_DIR, 'index.jsonl'), {
      ...meta({ slug: 'ghost', score: 100 }),
      path: 'good/react-vitest-playwright/pure-helpers/ghost.md', // file absent
    });
    const res = await retrieve.retrieveFewShot({ stack: 'react-vitest-playwright', kind: 'unit' });
    expect(res.length).toBeLessThanOrEqual(3); // topK default
    expect(res.map((r) => r.meta.slug)).not.toContain('ghost'); // empty body skipped
  });

  it('retrieveFewShot returns [] when nothing matches the query stack', async () => {
    const res = await retrieve.retrieveFewShot({ stack: 'no-such-stack', kind: 'unit' });
    expect(res).toEqual([]);
  });

  it('recentCaveats returns [] when the caveats file is missing (catch)', async () => {
    await rm(caveats.CAVEATS_PATH, { force: true });
    expect(await caveats.recentCaveats()).toEqual([]);
  });

  it('recentCaveats returns the last N non-empty lines', async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `caveat ${i}`).join('\n') + '\n\n'; // trailing blanks
    await mkdir(LIB_DIR, { recursive: true });
    await writeFile(caveats.CAVEATS_PATH, lines);
    const last3 = await caveats.recentCaveats(3);
    expect(last3).toEqual(['caveat 12', 'caveat 13', 'caveat 14']);
    expect(await caveats.recentCaveats()).toHaveLength(10); // default limit
  });
});

// ---------------------------------------------------------------------------
// complexity.ts
// ---------------------------------------------------------------------------
describe('complexity.routeModels', () => {
  it('auto routes by complexity', () => {
    expect(routeModels('auto', false)).toEqual({ primary: HAIKU, takeover: SONNET });
    expect(routeModels('auto', true)).toEqual({ primary: SONNET, takeover: SONNET });
  });
  it('explicit tiers', () => {
    expect(routeModels('haiku', false)).toEqual({ primary: HAIKU, takeover: SONNET });
    expect(routeModels('sonnet', false)).toEqual({ primary: SONNET, takeover: SONNET });
    expect(routeModels('opus', false)).toEqual({ primary: OPUS, takeover: OPUS });
  });
  it('self-hosted / host-serviced brains take over with themselves', () => {
    expect(routeModels('bridge', false)).toEqual({ primary: 'bridge', takeover: 'bridge' });
    expect(routeModels('claude-code', false)).toEqual({ primary: 'claude-code', takeover: 'claude-code' });
    expect(routeModels('cc:haiku', false)).toEqual({ primary: 'cc:haiku', takeover: 'cc:haiku' });
    expect(routeModels('openai:gpt', false)).toEqual({ primary: 'openai:gpt', takeover: 'openai:gpt' });
    expect(routeModels('local:qwen', false)).toEqual({ primary: 'local:qwen', takeover: 'local:qwen' });
  });
  it('explicit Anthropic model id falls back to Sonnet takeover', () => {
    expect(routeModels('claude-3-7-sonnet-x', false)).toEqual({ primary: 'claude-3-7-sonnet-x', takeover: SONNET });
  });
});

describe('complexity.assessComplexity', () => {
  async function scaffold(n: number, networked: boolean): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'pv-cplx-'));
    const srcDir = join(dir, 'src');
    await mkdir(srcDir, { recursive: true });
    for (let i = 0; i < n; i++) {
      const body =
        networked && i === 0 ? `export function f${i}() { return fetch('/api'); }\n` : `export const v${i} = ${i};\n`;
      await writeFile(join(srcDir, `m${i}.ts`), body);
    }
    return dir;
  }

  it('empty project, no heavy targets => not complex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-cplx-empty-'));
    const c = await assessComplexity(dir, []);
    expect(c.complex).toBe(false);
    expect(c.score).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('large networked app scores high and is complex', async () => {
    const dir = await scaffold(25, true);
    const c = await assessComplexity(dir, []);
    expect(c.complex).toBe(true);
    expect(c.score).toBeGreaterThanOrEqual(4); // +3 large +1 networked
    expect(c.reasons.join(' ')).toMatch(/large app \(2[5-9] modules\)|large app \(\d+ modules\)/);
    expect(c.reasons).toContain('networked');
    rmSync(dir, { recursive: true, force: true });
  });

  it('mid app + heavy redux/router targets', async () => {
    const dir = await scaffold(16, false);
    const c = await assessComplexity(dir, [
      { kind: 'unit', sourcePath: 'a.tsx', name: 'A', meta: { cost: 6 } },
      { kind: 'unit', sourcePath: 'b.tsx', name: 'B', meta: { cost: 2 } }, // below threshold
    ]);
    expect(c.reasons.join(' ')).toContain('mid app');
    expect(c.reasons.join(' ')).toContain('redux/router-bound');
    expect(c.score).toBeGreaterThanOrEqual(3);
    expect(c.complex).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// fact-digest.ts
// ---------------------------------------------------------------------------
describe('fact-digest.factDigest', () => {
  it('extracts object/array/scalar const values and interface shapes', () => {
    const src = [
      `export const RATES = { a: 1, b: "}{", c: 'x\\'y' };`,
      `export const IDS = [1, 2, 3];`,
      `export const NAME = 'hello';`,
      `export interface Foo { id: string; name: string }`,
      `const PRIVATE = 42;`, // not exported -> ignored
    ].join('\n');
    const out = factDigest(src);
    expect(out).toContain('export const RATES = {');
    expect(out).toContain('}{'); // string-aware balance didn't trip on the brace-in-string
    expect(out).toContain('export const IDS = [1, 2, 3]');
    expect(out).toContain("export const NAME = 'hello'");
    expect(out).toContain('export interface Foo {');
    expect(out).not.toContain('PRIVATE');
  });

  it('skips an export const with no value on the line', () => {
    const out = factDigest('export const EMPTY =;\nexport const REAL = 5;');
    expect(out).toContain('export const REAL = 5');
    expect(out).not.toContain('EMPTY');
  });

  it('handles an unterminated balanced literal (depth never closes)', () => {
    const out = factDigest('export const OPEN = { a: 1, b: 2');
    expect(out).toContain('export const OPEN = {');
  });

  it('respects perItem and cap limits', () => {
    const big = `export const BIG = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => i))};`;
    const capped = factDigest(big, { cap: 50, perItem: 30 });
    expect(capped.length).toBeLessThanOrEqual(50);
  });

  it('escaped quote inside a string literal is handled', () => {
    const out = factDigest('export const S = { v: "a\\"b}" };');
    expect(out).toContain('export const S = {');
  });
});

// ---------------------------------------------------------------------------
// passk.ts
// ---------------------------------------------------------------------------
describe('passk.scoreSuite', () => {
  function adapter(over: Partial<StackAdapter> = {}): StackAdapter {
    return {
      id: 'fake',
      run: async () => ({ passed: 4, failed: 0, skipped: 0, green: true, raw: '' }),
      coverage: async () => ({ statements: 80, branches: 70, functions: 60, lines: 80, ok: true }),
      specFiles: async () => [],
      auditRules: () => [],
      ...over,
    } as unknown as StackAdapter;
  }

  it('green suite => value = coverage + passed*2 + auditScore*5', async () => {
    const s = await scoreSuite('/x', adapter());
    expect(s.green).toBe(true);
    expect(s.tests).toBe(4);
    expect(s.coverage).toBe(80);
    expect(s.auditScore).toBe(5); // empty specFiles => no violations => clean
    expect(s.value).toBe(80 + 4 * 2 + 5 * 5);
  });

  it('red suite => value -1', async () => {
    const s = await scoreSuite(
      '/x',
      adapter({ run: async () => ({ passed: 0, failed: 1, skipped: 0, green: false, raw: '' }) }),
    );
    expect(s.value).toBe(-1);
  });

  it('coverage failure (catch -> null) and !cov.ok both yield coverage 0', async () => {
    const rej = await scoreSuite('/x', adapter({ coverage: async () => Promise.reject(new Error('boom')) }));
    expect(rej.coverage).toBe(0);
    expect(rej.value).toBe(0 + 4 * 2 + 5 * 5);
    const notOk = await scoreSuite('/x', adapter({
      coverage: async () => ({ statements: 50, branches: 0, functions: 0, lines: 0, ok: false }),
    }));
    expect(notOk.coverage).toBe(0);
  });

  it('audit errors > 0 => worthless (value -1) even when green', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-passk-'));
    await writeFile(join(dir, 'bad.spec.ts'), 'it("x", () => {});\n');
    const a = adapter({
      specFiles: async () => ['bad.spec.ts'],
      auditRules: () => [{ id: 'always', severity: 'error', check: () => 'nope' }],
    });
    const s = await scoreSuite(dir, a);
    expect(s.auditErrors).toBeGreaterThan(0);
    expect(s.value).toBe(-1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('passk.selectBest', () => {
  const mk = (value: number, label: string): Candidate<string> => ({
    label,
    ref: label,
    score: { green: value >= 0, tests: 1, coverage: 0, auditScore: 0, auditErrors: 0, value } as SuiteScore,
  });

  it('returns null for an empty list', () => {
    expect(selectBest([])).toBeNull();
  });
  it('returns null when every candidate is negative', () => {
    expect(selectBest([mk(-1, 'a'), mk(-1, 'b')])).toBeNull();
  });
  it('picks the highest value', () => {
    expect(selectBest([mk(5, 'a'), mk(9, 'b'), mk(7, 'c')])?.label).toBe('b');
  });
  it('ties resolve to the first candidate', () => {
    expect(selectBest([mk(5, 'a'), mk(5, 'b')])?.label).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// engine-escalation.ts
// ---------------------------------------------------------------------------
type LRBundle = { lr: LoopRun; ctx: RunCtx; st: LoopState; messages: Msg[]; logs: string[] };

function makeLR(over: Partial<LoopRun> = {}, stOver: Partial<LoopState> = {}): LRBundle {
  const ctx = new RunCtx('/wd', {} as unknown as StackAdapter, 'task');
  const messages: Msg[] = [];
  const logs: string[] = [];
  const brain = {
    id: 'b',
    model: 'm',
    complete: async (): Promise<BrainResponse> => ({
      text: '',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { input: 0, output: 0 },
    }),
  };
  const st: LoopState = {
    brain,
    tookOver: false,
    consulted: false,
    nudges: 0,
    accepted: false,
    stopReason: 'max_steps',
    exemplarShown: false,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    costUsd: 0,
    ...stOver,
  };
  const lr: LoopRun = {
    opts: {} as unknown as RunOptions,
    ctx,
    runes: [],
    messages,
    system: 'sys',
    log: (l: string) => logs.push(l),
    st,
    runId: 'r',
    eventsOn: false,
    eventsPath: '',
    maxSteps: 24,
    forceStopAfter: 6,
    consultAfter: 3,
    consultAtStep: 14,
    nudgeAfter: 5,
    readBudget: 5,
    transcriptOn: false,
    transcriptPath: '',
    ...over,
  };
  return { lr, ctx, st, messages, logs };
}

describe('engine-escalation.nudgeCheck', () => {
  it('no-op once an edit has started', () => {
    const { lr } = makeLR();
    lr.ctx.barren = 10;
    expect(nudgeCheck(lr, true)).toBe(false);
  });
  it('no-op when nudges already maxed (>=2)', () => {
    const { lr } = makeLR({}, { nudges: 2 });
    lr.ctx.barren = 10;
    expect(nudgeCheck(lr, false)).toBe(false);
  });
  it('no-op when neither barren nor read budget reached', () => {
    const { lr } = makeLR();
    lr.ctx.barren = 1;
    lr.ctx.reads = 1;
    expect(nudgeCheck(lr, false)).toBe(false);
  });
  it('fires a soft nudge on barren threshold', () => {
    const { lr, st, messages } = makeLR();
    lr.ctx.barren = 5; // == nudgeAfter
    lr.ctx.reads = 2;
    lr.ctx.step = 5;
    expect(nudgeCheck(lr, false)).toBe(true);
    expect(st.nudges).toBe(1);
    expect(messages[0].text).toContain("STOP reading");
    expect(messages[0].text).not.toContain('STILL no edit');
  });
  it('fires a hard nudge on the read budget once already nudged', () => {
    const { lr, st, messages } = makeLR({}, { nudges: 1 });
    lr.ctx.barren = 0;
    lr.ctx.reads = 5; // == readBudget
    expect(nudgeCheck(lr, false)).toBe(true);
    expect(st.nudges).toBe(2);
    expect(messages[0].text).toContain('STILL no edit');
  });
});

describe('engine-escalation.neverEditedCheck', () => {
  it('no-op when started', () => {
    const { lr } = makeLR();
    lr.ctx.barren = 99;
    expect(neverEditedCheck(lr, true)).toBe(false);
  });
  it('no-op below forceStopAfter', () => {
    const { lr } = makeLR();
    lr.ctx.barren = 5;
    expect(neverEditedCheck(lr, false)).toBe(false);
  });
  it('fires: sets difficulty stopReason + proposal', () => {
    const { lr, st } = makeLR();
    lr.ctx.barren = 6;
    lr.ctx.step = 6;
    expect(neverEditedCheck(lr, false)).toBe(true);
    expect(st.stopReason).toBe('difficulty');
    expect(st.proposalText).toContain('No test file produced');
  });
});

describe('engine-escalation.consultCheck', () => {
  it('no-op when not started', async () => {
    const { lr } = makeLR();
    lr.ctx.barren = 99;
    expect(await consultCheck(lr, false)).toBe(false);
  });
  it('no-op below consultAfter', async () => {
    const { lr } = makeLR();
    lr.ctx.barren = 1;
    expect(await consultCheck(lr, true)).toBe(false);
  });
  it('no-op when already consulted', async () => {
    const { lr } = makeLR({}, { consulted: true });
    lr.ctx.barren = 5;
    expect(await consultCheck(lr, true)).toBe(false);
  });
  it('takeover path swaps brain + sets tookOver and resets barren', async () => {
    const takeoverBrain = { id: 't', model: 'takeover-model', complete: async () => ({} as BrainResponse) };
    const { lr, st, messages, logs } = makeLR({
      opts: { takeoverBrain } as unknown as RunOptions,
    });
    lr.ctx.barren = 3; // == consultAfter
    expect(await consultCheck(lr, true)).toBe(true);
    expect(st.consulted).toBe(true);
    expect(st.tookOver).toBe(true);
    expect(st.brain.model).toBe('takeover-model');
    expect(lr.ctx.barren).toBe(0);
    expect(messages[0].text).toContain('stronger model');
    expect(logs.join(' ')).toContain('TAKEOVER');
  });
  it('no-takeover path injects extra onConsult guidance once', async () => {
    const onConsult = async () => 'EXEMPLAR-BODY';
    const { lr, st, messages, logs } = makeLR({
      opts: { onConsult } as unknown as RunOptions,
    });
    lr.ctx.barren = 4;
    expect(await consultCheck(lr, true)).toBe(true);
    expect(st.tookOver).toBe(false);
    expect(st.exemplarShown).toBe(true);
    expect(messages[0].text).toContain('HELP:');
    expect(messages[0].text).toContain('EXEMPLAR-BODY');
    expect(logs.join(' ')).toContain('injecting extra guidance');
  });
  it('skips onConsult when an exemplar was already shown', async () => {
    let called = false;
    const onConsult = async () => {
      called = true;
      return 'X';
    };
    const { lr, messages } = makeLR(
      { opts: { onConsult } as unknown as RunOptions },
      { exemplarShown: true },
    );
    lr.ctx.barren = 3;
    expect(await consultCheck(lr, true)).toBe(true);
    expect(called).toBe(false);
    expect(messages[0].text).not.toContain('HELP:');
  });

  // Gate-stall: the edit-happy-thrash blind spot. `barren` stays low (every edit
  // resets it) but the run keeps failing gates past consultAtStep → escalate.
  it('GATE-STALL: fires past consultAtStep with gate blocks even when barren is low', async () => {
    const takeoverBrain = { id: 't', model: 'takeover-model', complete: async () => ({} as BrainResponse) };
    const { lr, st, messages } = makeLR({ opts: { takeoverBrain } as unknown as RunOptions });
    lr.ctx.barren = 0; // never idle — edited every turn
    lr.ctx.step = 14; // == consultAtStep
    lr.ctx.gateBlocks = 1; // gates are failing
    expect(await consultCheck(lr, true)).toBe(true);
    expect(st.tookOver).toBe(true);
    expect(st.brain.model).toBe('takeover-model');
    expect(messages[0].text).toContain('gates are still failing');
    expect(messages[0].text).not.toContain('no productive change');
  });
  it('GATE-STALL: no-op before consultAtStep', async () => {
    const { lr } = makeLR();
    lr.ctx.barren = 0;
    lr.ctx.step = 13; // < consultAtStep
    lr.ctx.gateBlocks = 3;
    expect(await consultCheck(lr, true)).toBe(false);
  });
  it('GATE-STALL: no-op past consultAtStep when no gate has blocked (healthy long run)', async () => {
    const { lr } = makeLR();
    lr.ctx.barren = 0;
    lr.ctx.step = 20; // past consultAtStep
    lr.ctx.gateBlocks = 0; // never failed a gate — don't disturb it
    expect(await consultCheck(lr, true)).toBe(false);
  });
});

describe('engine-escalation.difficultyCheck', () => {
  const old = process.env.PROBEVANE_DETERMINISTIC;
  afterEach(() => {
    if (old === undefined) delete process.env.PROBEVANE_DETERMINISTIC;
    else process.env.PROBEVANE_DETERMINISTIC = old;
  });

  function circular(lr: LoopRun) {
    // 3 identical gate-block reasons trips isCircular
    lr.ctx.gateBlockHistory.push('same', 'same', 'same');
  }

  it('no-op when not started', async () => {
    const { lr } = makeLR({}, { consulted: true });
    circular(lr);
    expect(await difficultyCheck(lr, false)).toBe(false);
  });
  it('no-op when not yet consulted', async () => {
    const { lr } = makeLR();
    circular(lr);
    expect(await difficultyCheck(lr, true)).toBe(false);
  });
  it('no-op when not circular', async () => {
    const { lr } = makeLR({}, { consulted: true });
    expect(await difficultyCheck(lr, true)).toBe(false);
  });
  it('deterministic mode: stops + proposes WITHOUT a brain call', async () => {
    process.env.PROBEVANE_DETERMINISTIC = '1';
    let called = false;
    const { lr, st } = makeLR({}, { consulted: true });
    st.brain = { id: 'b', model: 'm', complete: async () => { called = true; return {} as BrainResponse; } };
    circular(lr);
    expect(await difficultyCheck(lr, true)).toBe(true);
    expect(called).toBe(false);
    expect(st.stopReason).toBe('difficulty');
    expect(st.proposalText).toContain('Stuck');
  });
  it('non-deterministic with budget headroom appends the model proposal', async () => {
    delete process.env.PROBEVANE_DETERMINISTIC;
    const { lr, st } = makeLR(
      { opts: { budget: 1000 } as unknown as RunOptions },
      { consulted: true, tokensOut: 0 },
    );
    st.brain = {
      id: 'b',
      model: 'm',
      complete: async (): Promise<BrainResponse> => ({
        text: 'try a smaller target',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { input: 10, output: 20, cacheRead: 2, costUsd: 0.01 },
      }),
    };
    circular(lr);
    expect(await difficultyCheck(lr, true)).toBe(true);
    expect(st.proposalText).toContain('Model: try a smaller target');
    expect(st.tokensIn).toBe(10);
    expect(st.tokensOut).toBe(20);
    expect(st.stopReason).toBe('difficulty');
  });
  it('brain error is swallowed; deterministic proposal still stands', async () => {
    delete process.env.PROBEVANE_DETERMINISTIC;
    const { lr, st } = makeLR(
      { opts: { budget: 1000 } as unknown as RunOptions },
      { consulted: true },
    );
    st.brain = { id: 'b', model: 'm', complete: async () => { throw new Error('429'); } };
    circular(lr);
    expect(await difficultyCheck(lr, true)).toBe(true);
    expect(st.proposalText).toContain('Stuck');
    expect(st.proposalText).not.toContain('Model:');
  });
  it('out-of-budget skips the brain call entirely', async () => {
    delete process.env.PROBEVANE_DETERMINISTIC;
    let called = false;
    const { lr, st } = makeLR(
      { opts: { budget: 10 } as unknown as RunOptions },
      { consulted: true, tokensOut: 50 },
    );
    st.brain = { id: 'b', model: 'm', complete: async () => { called = true; return {} as BrainResponse; } };
    circular(lr);
    expect(await difficultyCheck(lr, true)).toBe(true);
    expect(called).toBe(false);
  });
});

describe('engine-escalation.fatalCheck', () => {
  it('no-op when no fatal diagnosis', () => {
    const { lr } = makeLR();
    expect(fatalCheck(lr)).toBe(false);
  });
  it('fires: a gate-set fatalDiagnosis stops honestly (misconfigured + proposal)', () => {
    const { lr, st } = makeLR();
    lr.ctx.fatalDiagnosis = '0 tests collected across 2 attempts — scope/config mismatch, not fixable by editing code.';
    expect(fatalCheck(lr)).toBe(true);
    expect(st.stopReason).toBe('misconfigured');
    expect(st.proposalText).toContain('scope/config');
  });
});

describe('engine-escalation.stuckCheck', () => {
  it('no-op when not started', () => {
    const { lr } = makeLR();
    lr.ctx.barren = 99;
    expect(stuckCheck(lr, false)).toBe(false);
  });
  it('no-op below forceStopAfter', () => {
    const { lr } = makeLR();
    lr.ctx.barren = 5;
    expect(stuckCheck(lr, true)).toBe(false);
  });
  it('fires: sets stuck stopReason', () => {
    const { lr, st } = makeLR();
    lr.ctx.barren = 6;
    expect(stuckCheck(lr, true)).toBe(true);
    expect(st.stopReason).toBe('stuck');
  });
});

describe('engine-escalation.budgetCheck', () => {
  it('no-op when no budget set', () => {
    const { lr } = makeLR();
    expect(budgetCheck(lr)).toBe(false);
  });
  it('no-op when under budget', () => {
    const { lr } = makeLR({ opts: { budget: 100 } as unknown as RunOptions }, { tokensOut: 50 });
    expect(budgetCheck(lr)).toBe(false);
  });
  it('fires when output tokens reach the budget', () => {
    const { lr, st } = makeLR({ opts: { budget: 100 } as unknown as RunOptions }, { tokensOut: 150 });
    expect(budgetCheck(lr)).toBe(true);
    expect(st.stopReason).toBe('budget');
  });
});
