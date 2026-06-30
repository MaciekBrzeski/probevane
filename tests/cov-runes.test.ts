import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Library modules are mocked so context_inject's RAG branches + caveat_harvest's
// file target are deterministic and isolated from the real ~/.local/share lib.
// ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  caveatsPath: `${process.env.TMPDIR || '/tmp'}/pv-cov-caveats-${process.pid}-${Math.random().toString(36).slice(2)}.md`,
  prompt: '' as string,
  caveats: [] as string[],
  examples: [] as any[],
}));
vi.mock('../src/library/prompt.js', () => ({ loadPrompt: async () => h.prompt }));
vi.mock('../src/library/caveats.js', () => ({
  CAVEATS_PATH: h.caveatsPath,
  recentCaveats: async () => h.caveats,
}));
vi.mock('../src/library/retrieve.js', () => ({ retrieveFewShot: async () => h.examples }));

import { RunCtx } from '../src/loop/ctx.js';
import { validationGate, firstFailure, countTsErrors, newSpecs } from '../src/loop/runes/validation_gate.js';
import { acceptanceGate } from '../src/loop/runes/acceptance_gate.js';
import { behaviorLock } from '../src/loop/runes/behavior_lock.js';
import { redFirst } from '../src/loop/runes/red_first.js';
import { contextInject } from '../src/loop/runes/context_inject.js';
import { noRegression } from '../src/loop/runes/no_regression.js';
import { sessionDiary } from '../src/loop/runes/session_diary.js';
import { caveatHarvest } from '../src/loop/runes/caveat_harvest.js';
import { planFirst } from '../src/loop/runes/plan_first.js';
import { mockInject } from '../src/loop/runes/mock_inject.js';
import { pathGuard } from '../src/loop/runes/path_guard.js';
import type { ToolCall, ToolResult } from '../src/loop/types.js';

// ── fake adapter ─────────────────────────────────────────────────────────────
// Mutable canned values: tests reassign `_cmds` / `_run` / `_cov` / `_specs`
// between prepare() (baseline) and shouldStop() (after-edit) phases.
function fakeAdapter(): any {
  return {
    id: 'react-vitest-playwright',
    _cmds: { typecheck: 'true', lint: 'true', testUnit: 'true', testE2e: 'true', coverage: 'true' },
    _run: { passed: 1, failed: 0, skipped: 0, green: true, raw: '' } as const,
    _cov: { statements: 100, branches: 100, functions: 100, lines: 100, ok: true },
    _specs: [] as string[],
    _patterns: 'PATTERNS-DOC',
    commands() {
      return this._cmds;
    },
    async run(_dir: string, _scope: string, _files?: string[]) {
      return this._run;
    },
    async coverage() {
      return this._cov;
    },
    async specFiles() {
      return this._specs;
    },
    async patternsDoc() {
      return this._patterns;
    },
  };
}

const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: 'c1', name, input });
const okResult: ToolResult = { id: 'c1', content: 'ok', isError: false };

let workdir: string;
beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'pv-cov-'));
});
afterAll(() => {
  delete process.env.PROBEVANE_DETERMINISTIC;
});

function ctxWith(adapter: any): RunCtx {
  return new RunCtx(workdir, adapter, 'add unit tests for the widget');
}

// ─── validation_gate ─────────────────────────────────────────────────────────
describe('validationGate', () => {
  it('systemPromptAddition states the FINISH RULE', () => {
    expect(validationGate().systemPromptAddition!()).toContain('FINISH RULE');
  });

  it('prepare on a clean project returns undefined (baseline ok, 0 errors)', async () => {
    const a = fakeAdapter();
    const rune = validationGate('unit');
    const note = await rune.prepare!(ctxWith(a));
    expect(note).toBeUndefined();
  });

  it('prepare on a dirty project returns the pre-existing-errors note', async () => {
    const a = fakeAdapter();
    a._cmds.typecheck = 'echo "error TS111: a"; echo "error TS222: b"; exit 1';
    const rune = validationGate('unit');
    const note = await rune.prepare!(ctxWith(a));
    expect(note).toContain('2 pre-existing type error');
  });

  it('shouldStop blocks when no test file was written', async () => {
    const a = fakeAdapter();
    const rune = validationGate('unit');
    const ctx = ctxWith(a);
    await rune.prepare!(ctx);
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('no test file was written');
  });

  it('shouldStop blocks when the edits ADD type errors over baseline', async () => {
    const a = fakeAdapter();
    const rune = validationGate('unit');
    const ctx = ctxWith(a);
    await rune.prepare!(ctx); // baseline: ok, 0 errors
    a._cmds.typecheck = 'echo "error TS999: boom"; exit 1';
    ctx.editedFiles.add('src/widget.test.ts');
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.reason).toContain('typecheck added 1 new type error');
      expect(d.inject).toContain('introduced type errors');
    }
  });

  it('shouldStop does NOT block when error count stays at the dirty baseline', async () => {
    const a = fakeAdapter();
    a._cmds.typecheck = 'echo "error TS111: a"; exit 1'; // 1 error, persistent
    const rune = validationGate('unit');
    const ctx = ctxWith(a);
    await rune.prepare!(ctx); // baseline = 1 error
    ctx.editedFiles.add('src/widget.test.ts'); // suite is green below
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('allow'); // 1 !> 1, suite green
  });

  it('shouldStop blocks when the scoped tests are red (with FIX THIS FIRST focus)', async () => {
    const a = fakeAdapter();
    a._run = {
      passed: 2,
      failed: 1,
      skipped: 0,
      green: false,
      raw: 'PASS ok one\n× widget renders\n  AssertionError: expected 1 to be 2\nPASS ok two',
    };
    const rune = validationGate('unit');
    const ctx = ctxWith(a);
    await rune.prepare!(ctx);
    ctx.editedFiles.add('src/widget.test.ts');
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.reason).toContain('unit tests not green');
      expect(d.inject).toContain('FIX THIS FIRST');
      expect(d.inject).toContain('AssertionError');
    }
  });

  it('shouldStop allows when edited + typecheck clean + suite green (full=true scope)', async () => {
    const a = fakeAdapter();
    a._run = { passed: 5, failed: 0, skipped: 0, green: true, raw: 'all good' };
    const rune = validationGate('unit', true); // full → whole-suite run, ours=[]
    const ctx = ctxWith(a);
    await rune.prepare!(ctx);
    ctx.editedFiles.add('src/widget.ts'); // size>0 but not a spec; full=true ignores anyway
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('allow');
    expect(ctx.validatedSinceEdit).toBe(true);
  });

  it('red-but-no-marker still blocks with empty focus', async () => {
    const a = fakeAdapter();
    a._run = { passed: 0, failed: 1, skipped: 0, green: false, raw: 'nothing parseable here' };
    const rune = validationGate('unit');
    const ctx = ctxWith(a);
    await rune.prepare!(ctx);
    ctx.editedFiles.add('src/x.test.ts');
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.inject).not.toContain('FIX THIS FIRST');
  });
});

describe('validation_gate helpers', () => {
  it('countTsErrors counts each occurrence', () => {
    expect(countTsErrors('')).toBe(0);
    expect(countTsErrors('error TS1: a\nfoo\nerror TS2: b')).toBe(2);
  });

  it('newSpecs filters editedFiles to spec paths only', () => {
    const a = fakeAdapter();
    const ctx = ctxWith(a);
    ctx.editedFiles.add('src/a.ts');
    ctx.editedFiles.add('src/a.test.ts');
    ctx.editedFiles.add('tests/b.spec.tsx');
    ctx.editedFiles.add('test_thing.py');
    ctx.editedFiles.add('readme.md');
    expect(newSpecs(ctx).sort()).toEqual(['src/a.test.ts', 'test_thing.py', 'tests/b.spec.tsx']);
  });

  it('firstFailure returns undefined on empty / no-marker input', () => {
    expect(firstFailure('')).toBeUndefined();
    expect(firstFailure('all green\nPASS one\nPASS two')).toBeUndefined();
  });

  it('firstFailure captures the marker block and stops at the next result line', () => {
    const raw = ['✓ test a', '× test b', '  expected 1 but got 2', '  at line 3', '✓ test c', '  not me'].join('\n');
    const out = firstFailure(raw)!;
    expect(out).toContain('test b');
    expect(out).toContain('expected 1 but got 2');
    expect(out).not.toContain('not me');
  });
});

// ─── acceptance_gate ─────────────────────────────────────────────────────────
describe('acceptanceGate', () => {
  it('allows when no criteria are configured', async () => {
    const a = fakeAdapter();
    const d = await acceptanceGate({ scope: 'unit' }).shouldStop!(ctxWith(a));
    expect(d.kind).toBe('allow');
  });

  it('blocks when passing test count is below minTests', async () => {
    const a = fakeAdapter();
    a._run = { passed: 3, failed: 0, skipped: 0, green: true, raw: '' };
    const ctx = ctxWith(a);
    ctx.editedFiles.add('src/a.test.ts');
    const d = await acceptanceGate({ scope: 'unit', minTests: 5 }).shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('only 3 passing tests');
    expect(ctx.lastRunPassed).toBe(3);
  });

  it('allows minTests when count is met', async () => {
    const a = fakeAdapter();
    a._run = { passed: 7, failed: 0, skipped: 0, green: true, raw: '' };
    const d = await acceptanceGate({ scope: 'unit', minTests: 5 }).shouldStop!(ctxWith(a));
    expect(d.kind).toBe('allow');
  });

  it('blocks when coverage is below minCoverage', async () => {
    const a = fakeAdapter();
    a._cov = { statements: 50, branches: 50, functions: 50, lines: 50, ok: true };
    const ctx = ctxWith(a);
    const d = await acceptanceGate({ scope: 'unit', minCoverage: 80 }).shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('coverage 50% < 80%');
    expect(ctx.lastCoverage).toBe(50);
  });

  it('blocks when coverage is unavailable', async () => {
    const a = fakeAdapter();
    a._cov = { statements: 0, branches: 0, functions: 0, lines: 0, ok: false };
    const d = await acceptanceGate({ scope: 'unit', minCoverage: 80 }).shouldStop!(ctxWith(a));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('coverage unavailable');
  });

  it('allows when coverage meets the threshold', async () => {
    const a = fakeAdapter();
    a._cov = { statements: 95, branches: 90, functions: 90, lines: 95, ok: true };
    const d = await acceptanceGate({ scope: 'unit', minCoverage: 80 }).shouldStop!(ctxWith(a));
    expect(d.kind).toBe('allow');
  });

  it('blocks when a shell check fails and allows when they pass', async () => {
    const a = fakeAdapter();
    const fail = await acceptanceGate({ scope: 'unit', shellChecks: ['true', 'exit 3'] }).shouldStop!(ctxWith(a));
    expect(fail.kind).toBe('block');
    if (fail.kind === 'block') expect(fail.reason).toContain('check failed');
    const pass = await acceptanceGate({ scope: 'unit', shellChecks: ['true', 'true'] }).shouldStop!(ctxWith(a));
    expect(pass.kind).toBe('allow');
  });
});

// ─── behavior_lock ───────────────────────────────────────────────────────────
describe('behaviorLock', () => {
  it('systemPromptAddition states the REFACTOR RULES', () => {
    expect(behaviorLock().systemPromptAddition!()).toContain('REFACTOR RULES');
  });

  it('prepare with a green baseline reports the contract count', async () => {
    const a = fakeAdapter();
    a._run = { passed: 4, failed: 0, skipped: 0, green: true, raw: '' };
    const note = await behaviorLock().prepare!(ctxWith(a));
    expect(note).toContain('4 tests must remain green');
  });

  it('prepare with no passing tests warns', async () => {
    const a = fakeAdapter();
    a._run = { passed: 0, failed: 0, skipped: 0, green: false, raw: '' };
    const note = await behaviorLock().prepare!(ctxWith(a));
    expect(note).toContain('no passing tests found');
  });

  it('beforeToolCall blocks editing a test file, allows source + non-writes', async () => {
    const rune = behaviorLock();
    const ctx = ctxWith(fakeAdapter());
    const blocked = await rune.beforeToolCall!(call('write_file', { path: 'src/a.test.ts' }), ctx);
    expect(blocked.kind).toBe('block');
    if (blocked.kind === 'block') expect(blocked.reason).toContain('test files are read-only');
    expect((await rune.beforeToolCall!(call('edit_file', { path: 'src/a.ts' }), ctx)).kind).toBe('allow');
    expect((await rune.beforeToolCall!(call('read_file', { path: 'src/a.test.ts' }), ctx)).kind).toBe('allow');
    expect((await rune.beforeToolCall!(call('delete_file', { path: 'src/a.spec.ts' }), ctx)).kind).toBe('block');
  });

  it('shouldStop blocks when nothing was refactored (only specs edited)', async () => {
    const a = fakeAdapter();
    const rune = behaviorLock();
    const ctx = ctxWith(a);
    await rune.prepare!(ctx);
    ctx.editedFiles.add('src/a.test.ts');
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('nothing was refactored');
  });

  it('shouldStop blocks when typecheck breaks after a refactor', async () => {
    const a = fakeAdapter();
    a._run = { passed: 2, failed: 0, skipped: 0, green: true, raw: '' };
    const rune = behaviorLock();
    const ctx = ctxWith(a);
    await rune.prepare!(ctx); // baselineTypecheckOk = true
    a._cmds.typecheck = 'echo "error TS900: nope"; exit 1';
    ctx.editedFiles.add('src/a.ts');
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('typecheck failed');
  });

  it('shouldStop blocks when a refactor drops the green count', async () => {
    const a = fakeAdapter();
    a._run = { passed: 3, failed: 0, skipped: 0, green: true, raw: '' };
    const rune = behaviorLock();
    const ctx = ctxWith(a);
    await rune.prepare!(ctx); // baseline 3
    ctx.editedFiles.add('src/a.ts');
    a._run = { passed: 2, failed: 1, skipped: 0, green: false, raw: 'one test failed' };
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('behavior changed');
  });

  it('shouldStop allows when source changed, typecheck ok, suite preserved', async () => {
    const a = fakeAdapter();
    a._run = { passed: 3, failed: 0, skipped: 0, green: true, raw: '' };
    const rune = behaviorLock();
    const ctx = ctxWith(a);
    await rune.prepare!(ctx);
    ctx.editedFiles.add('src/a.ts');
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('allow');
  });

  it('skips the typecheck gate when the baseline typecheck was already dirty', async () => {
    const a = fakeAdapter();
    a._cmds.typecheck = 'echo "error TS1: x"; exit 1'; // baseline dirty
    a._run = { passed: 1, failed: 0, skipped: 0, green: true, raw: '' };
    const rune = behaviorLock();
    const ctx = ctxWith(a);
    await rune.prepare!(ctx); // baselineTypecheckOk=false → typecheck block skipped
    ctx.editedFiles.add('src/a.ts');
    const d = await rune.shouldStop!(ctx);
    expect(d.kind).toBe('allow');
  });
});

// ─── red_first ───────────────────────────────────────────────────────────────
describe('redFirst', () => {
  it('systemPromptAddition states the TDD red-first rule', () => {
    expect(redFirst().systemPromptAddition!()).toContain('red-first');
  });

  it('beforeToolCall blocks a source edit before any red test', async () => {
    const rune = redFirst();
    const ctx = ctxWith(fakeAdapter());
    const d = await rune.beforeToolCall!(call('edit_file', { path: 'src/widget.ts' }), ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('source edit before a failing test');
  });

  it('beforeToolCall allows writing a spec file', async () => {
    const rune = redFirst();
    const ctx = ctxWith(fakeAdapter());
    expect((await rune.beforeToolCall!(call('write_file', { path: 'src/widget.test.ts' }), ctx)).kind).toBe('allow');
    // non-writing tool is always allowed
    expect((await rune.beforeToolCall!(call('read_file', { path: 'src/widget.ts' }), ctx)).kind).toBe('allow');
  });

  it('shouldStop blocks until a red test is observed, then allows; unlocks source edits', async () => {
    const a = fakeAdapter();
    a._run = { passed: 0, failed: 1, skipped: 0, green: false, raw: 'red!' };
    const rune = redFirst();
    const ctx = ctxWith(a);

    expect((await rune.shouldStop!(ctx)).kind).toBe('block'); // not yet confirmed

    // writing a spec that runs red flips redConfirmed via afterToolCall
    await rune.afterToolCall!(call('write_file', { path: 'src/widget.test.ts' }), okResult, ctx);
    expect((await rune.shouldStop!(ctx)).kind).toBe('allow');
    // source edits now unlocked
    expect((await rune.beforeToolCall!(call('edit_file', { path: 'src/widget.ts' }), ctx)).kind).toBe('allow');
  });

  it('afterToolCall does not confirm red on an error result, a green run, or a non-spec', async () => {
    const a = fakeAdapter();
    a._run = { passed: 1, failed: 0, skipped: 0, green: true, raw: 'green' }; // green spec
    const rune = redFirst();
    const ctx = ctxWith(a);
    await rune.afterToolCall!(call('write_file', { path: 'src/w.test.ts' }), { ...okResult, isError: true }, ctx);
    await rune.afterToolCall!(call('write_file', { path: 'src/w.test.ts' }), okResult, ctx); // green → no confirm
    await rune.afterToolCall!(call('write_file', { path: 'src/w.ts' }), okResult, ctx); // not a spec
    expect((await rune.shouldStop!(ctx)).kind).toBe('block');
  });

  it('afterToolCall early-returns once already confirmed', async () => {
    const a = fakeAdapter();
    a._run = { passed: 0, failed: 1, skipped: 0, green: false, raw: 'red' };
    const rune = redFirst();
    const ctx = ctxWith(a);
    await rune.afterToolCall!(call('write_file', { path: 'a.test.ts' }), okResult, ctx); // confirms
    // switch run to green; a second afterToolCall must NOT un-confirm (early return)
    a._run = { passed: 1, failed: 0, skipped: 0, green: true, raw: 'green' };
    await rune.afterToolCall!(call('write_file', { path: 'a.test.ts' }), okResult, ctx);
    expect((await rune.shouldStop!(ctx)).kind).toBe('allow');
  });
});

// ─── context_inject ──────────────────────────────────────────────────────────
describe('contextInject', () => {
  it('deterministic mode includes quality + patterns but skips caveats/examples', async () => {
    process.env.PROBEVANE_DETERMINISTIC = '1';
    h.prompt = 'QUALITY-RULES';
    h.caveats = ['- should-be-skipped'];
    h.examples = [{ meta: { category: 'x', score: 1 }, body: 'skip' }];
    const out = await contextInject('unit').prepare!(ctxWith(fakeAdapter()));
    expect(out).toContain('QUALITY-RULES');
    expect(out).toContain('PATTERNS-DOC');
    expect(out).not.toContain('CAVEATS');
    expect(out).not.toContain('WORKED EXAMPLES');
    delete process.env.PROBEVANE_DETERMINISTIC;
  });

  it('non-deterministic mode injects caveats and worked examples', async () => {
    delete process.env.PROBEVANE_DETERMINISTIC;
    h.prompt = 'QUALITY-RULES';
    h.caveats = ['- avoid all-skipped'];
    h.examples = [
      { meta: { category: 'forms', score: 9 }, body: 'BODY-ONE' },
      { meta: { category: 'data' }, body: 'BODY-TWO' }, // score undefined → "?"
    ];
    const out = await contextInject('e2e').prepare!(ctxWith(fakeAdapter()));
    expect(out).toContain('CAVEATS from past runs');
    expect(out).toContain('avoid all-skipped');
    expect(out).toContain('WORKED EXAMPLES');
    expect(out).toContain('score 9');
    expect(out).toContain('score ?');
    expect(out).toContain('BODY-TWO');
  });

  it('returns undefined when nothing is available', async () => {
    delete process.env.PROBEVANE_DETERMINISTIC;
    h.prompt = '';
    h.caveats = [];
    h.examples = [];
    const a = fakeAdapter();
    a._patterns = '';
    const out = await contextInject('unit').prepare!(ctxWith(a));
    expect(out).toBeUndefined();
  });
});

// ─── no_regression ───────────────────────────────────────────────────────────
describe('noRegression', () => {
  it('prepare lists pre-existing specs (or returns undefined when none)', async () => {
    const a = fakeAdapter();
    a._specs = ['./src/existing.test.ts', 'tests/old.spec.ts'];
    const rune = noRegression();
    const note = await rune.prepare!(ctxWith(a));
    expect(note).toContain('NO REGRESSION');
    expect(note).toContain('src/existing.test.ts'); // normalized (./ stripped)

    const empty = noRegression();
    const a2 = fakeAdapter();
    a2._specs = [];
    expect(await empty.prepare!(ctxWith(a2))).toBeUndefined();
  });

  it('beforeToolCall blocks editing a pre-existing spec, allows new specs + reads', async () => {
    const a = fakeAdapter();
    a._specs = ['src/existing.test.ts'];
    const rune = noRegression();
    const ctx = ctxWith(a);
    await rune.prepare!(ctx);
    const blocked = await rune.beforeToolCall!(call('edit_file', { path: './src/existing.test.ts' }), ctx);
    expect(blocked.kind).toBe('block');
    if (blocked.kind === 'block') expect(blocked.reason).toContain('pre-existing test');
    expect((await rune.beforeToolCall!(call('write_file', { path: 'src/new.test.ts' }), ctx)).kind).toBe('allow');
    expect((await rune.beforeToolCall!(call('read_file', { path: 'src/existing.test.ts' }), ctx)).kind).toBe('allow');
  });
});

// ─── session_diary ───────────────────────────────────────────────────────────
describe('sessionDiary', () => {
  it('writes a per-run record keyed on runId', async () => {
    const a = fakeAdapter();
    const ctx = ctxWith(a);
    ctx.runId = 'run-abc';
    ctx.checkpointSha = 'deadbeef';
    ctx.accepted = true;
    ctx.stopReason = 'accepted';
    ctx.step = 7;
    ctx.toolCalls = 12;
    ctx.gateBlocks = 2;
    ctx.noteBlock('some gate reason');
    ctx.editedFiles.add('src/a.test.ts');
    ctx.plan = { text: 'a plan', at: 1 };
    await sessionDiary.onStop!(ctx);
    const rec = JSON.parse(await readFile(join(workdir, '.probevane', 'diary', 'run-abc.json'), 'utf8'));
    expect(rec.runId).toBe('run-abc');
    expect(rec.checkpointSha).toBe('deadbeef');
    expect(rec.accepted).toBe(true);
    expect(rec.steps).toBe(7);
    expect(rec.gateBlockReasons).toContain('some gate reason');
    expect(rec.editedFiles).toContain('src/a.test.ts');
    expect(rec.hadPlan).toBe(true);
  });

  it('falls back to run-<step> when runId is empty', async () => {
    const ctx = ctxWith(fakeAdapter());
    ctx.runId = '';
    ctx.step = 99;
    await sessionDiary.onStop!(ctx);
    const files = await readdir(join(workdir, '.probevane', 'diary'));
    expect(files).toContain('run-99.json');
  });
});

// ─── caveat_harvest ──────────────────────────────────────────────────────────
describe('caveatHarvest', () => {
  it('appends distinct gate-block reasons and dedupes across runs', async () => {
    const ctx = ctxWith(fakeAdapter());
    ctx.noteBlock('validation_gate: tests not green');
    await caveatHarvest.onStop!(ctx);
    let txt = await readFile(h.caveatsPath, 'utf8');
    expect(txt).toContain('[react-vitest-playwright] validation_gate: tests not green');

    // second run: one repeat (filtered) + one new
    const ctx2 = ctxWith(fakeAdapter());
    ctx2.noteBlock('validation_gate: tests not green'); // dup
    ctx2.noteBlock('acceptance_gate: coverage too low'); // new
    await caveatHarvest.onStop!(ctx2);
    txt = await readFile(h.caveatsPath, 'utf8');
    expect((txt.match(/validation_gate: tests not green/g) ?? []).length).toBe(1);
    expect(txt).toContain('acceptance_gate: coverage too low');
  });

  it('does nothing when there were no gate blocks', async () => {
    const ctx = ctxWith(fakeAdapter()); // no noteBlock calls
    await expect(caveatHarvest.onStop!(ctx)).resolves.toBeUndefined();
  });
});

// ─── plan_first ──────────────────────────────────────────────────────────────
describe('planFirst', () => {
  it('systemPromptAddition states the PLANNING DISCIPLINE', () => {
    expect(planFirst.systemPromptAddition!()).toContain('PLANNING DISCIPLINE');
  });

  it('blocks a write before plan and allows it after plan is recorded', async () => {
    const ctx = ctxWith(fakeAdapter());
    const blocked = await planFirst.beforeToolCall!(call('write_file', { path: 'src/a.test.ts' }), ctx);
    expect(blocked.kind).toBe('block');
    if (blocked.kind === 'block') expect(blocked.reason).toContain('write attempted before plan');
    // non-write tool is allowed even without a plan
    expect((await planFirst.beforeToolCall!(call('read_file', { path: 'src/a.ts' }), ctx)).kind).toBe('allow');
    ctx.plan = { text: 'planned', at: 0 };
    expect((await planFirst.beforeToolCall!(call('write_file', { path: 'src/a.test.ts' }), ctx)).kind).toBe('allow');
  });
});

// ─── mock_inject ─────────────────────────────────────────────────────────────
describe('mockInject', () => {
  it('returns undefined when the plan has no handlers and no dep mocks/props', async () => {
    const plan: any = { handlers: [], bundles: [{ depMocks: [], props: undefined }], digest: 'unused' };
    const out = await mockInject(plan).prepare!(ctxWith(fakeAdapter()));
    expect(out).toBeUndefined();
  });

  it('injects the mock boundary when there are network handlers', async () => {
    const plan: any = { handlers: [{ method: 'GET', urlPattern: '/api' }], bundles: [], digest: 'DIGEST-HANDLERS' };
    const out = await mockInject(plan).prepare!(ctxWith(fakeAdapter()));
    expect(out).toContain('MOCKS ARE PROVIDED');
    expect(out).toContain('DIGEST-HANDLERS');
  });

  it('injects the boundary when a bundle has dep mocks or props', async () => {
    const plan: any = { handlers: [], bundles: [{ depMocks: ['./api'], props: { a: 1 } }], digest: 'DIGEST-DEPS' };
    const out = await mockInject(plan).prepare!(ctxWith(fakeAdapter()));
    expect(out).toContain('DIGEST-DEPS');
  });
});

// ─── path_guard ──────────────────────────────────────────────────────────────
describe('pathGuard', () => {
  it('systemPromptAddition states the SCOPE rule', () => {
    expect(pathGuard.systemPromptAddition!()).toContain('SCOPE');
  });

  it('blocks writes/deletes into off-limits dirs and lockfiles', async () => {
    const ctx = ctxWith(fakeAdapter());
    const denied = [
      call('write_file', { path: 'node_modules/.bin/tsc' }),
      call('write_file', { path: 'src/.git/config' }),
      call('write_file', { path: 'dist/out.js' }),
      call('write_file', { path: 'build/x.js' }),
      call('write_file', { path: 'coverage/lcov.info' }),
      call('write_file', { path: 'package-lock.json' }),
      call('edit_file', { path: 'pnpm-lock.yaml' }),
      call('delete_file', { path: 'node_modules/foo/index.js' }),
    ];
    for (const c of denied) {
      const d = await pathGuard.beforeToolCall!(c, ctx);
      expect(d.kind, `${c.name} ${JSON.stringify(c.input)}`).toBe('block');
      if (d.kind === 'block') expect(d.reason).toContain('write outside scope');
    }
  });

  it('allows in-scope test writes and ignores non-write tools', async () => {
    const ctx = ctxWith(fakeAdapter());
    expect((await pathGuard.beforeToolCall!(call('write_file', { path: 'src/a.test.ts' }), ctx)).kind).toBe('allow');
    expect((await pathGuard.beforeToolCall!(call('write_file', { path: 'tests/b.spec.ts' }), ctx)).kind).toBe('allow');
    // read into node_modules is NOT a write → allowed by this gate
    expect((await pathGuard.beforeToolCall!(call('read_file', { path: 'node_modules/foo' }), ctx)).kind).toBe('allow');
  });
});
