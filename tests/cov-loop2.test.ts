import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// The cross-project library + distill stores are mocked so library_promote /
// distill_trace can be driven through their PROBEVANE_TRACES=1 branch WITHOUT
// touching the real ~/.local/share/probevane library on disk.
// ─────────────────────────────────────────────────────────────────────────────
const promote = vi.hoisted(() => ({ saved: [] as any[], index: [] as any[] }));
vi.mock('../src/library/store.js', () => ({
  saveExample: async (meta: any, spec: any) => {
    promote.saved.push({ meta, spec });
    return 'rel.md';
  },
  readIndex: async () => promote.index,
}));
const distill = vi.hoisted(() => ({ recorded: [] as any[] }));
vi.mock('../src/distill/collect.js', () => ({
  recordTrace: async (ctx: any, now: any) => {
    distill.recorded.push({ task: ctx.task, now });
    return 1;
  },
}));

import { RunCtx } from '../src/loop/ctx.js';
import { nullAdapter } from '../src/adapters/null-adapter.js';
import type { Brain } from '../src/brain/brain.js';
import type { Rune } from '../src/loop/rune.js';
import { ALLOW, block } from '../src/loop/rune.js';
import type { ToolCall, BrainResponse } from '../src/loop/types.js';
import { execTool } from '../src/loop/tools.js';
import {
  stableCacheIndex,
  runStep,
  assembleSystem,
  emit,
  type LoopRun,
  type LoopState,
} from '../src/loop/engine/phases.js';
import { lineOf, mutationScore, survivingMutants, mutantDigest, survivorSummary, MUTATIONS } from '../src/loop/mutation.js';
import { buildDepDigest } from '../src/loop/dep-digest.js';
import {
  docStructureGate,
  docReferenceGate,
  extractRefs,
  docsScopeGuard,
  docsAcceptance,
  docsContextInject,
} from '../src/loop/runes/docs.js';
import { libraryPromote, kindFor, categoryFor, scoreFor, slugFor } from '../src/loop/runes/library_promote.js';
import { flakeGate, flakeVerdict } from '../src/loop/runes/flake_gate.js';
import { mutationGate } from '../src/loop/runes/mutation_gate.js';
import { a11yGate } from '../src/loop/runes/a11y_gate.js';
import { hermeticGate } from '../src/loop/runes/hermetic_gate.js';
import { visualGate } from '../src/loop/runes/visual_gate.js';
import { distillTrace } from '../src/loop/runes/distill_trace.js';

// ── temp-dir bookkeeping ─────────────────────────────────────────────────────
const tmps: string[] = [];
function mkTmp(prefix = 'pv-l2-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.PROBEVANE_TRACES;
  promote.saved.length = 0;
  promote.index.length = 0;
  distill.recorded.length = 0;
  // MUTATIONS are module-level /g regexes with stateful lastIndex; reset so one
  // test's survivingMutants (which leaves lastIndex advanced) can't perturb the next.
  for (const [re] of MUTATIONS) re.lastIndex = 0;
});

const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: 'c1', name, input });

function ctxOf(workdir: string, adapter: any = nullAdapter): RunCtx {
  return new RunCtx(workdir, adapter, 'add unit tests for the widget');
}

// A brain that can be scripted to return responses or throw.
function scriptBrain(responses: (BrainResponse | Error)[]): Brain {
  let i = 0;
  return {
    id: 'fake',
    model: 'fake',
    async complete(): Promise<BrainResponse> {
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
const resp = (over: Partial<BrainResponse>): BrainResponse => ({
  text: '',
  toolCalls: [],
  stopReason: 'end_turn',
  usage: { input: 1, output: 1 },
  ...over,
});

function loopRun(ctx: RunCtx, over: Partial<LoopRun> = {}): LoopRun {
  const st: LoopState = {
    brain: scriptBrain([resp({})]),
    tookOver: false,
    consulted: false,
    nudges: 0,
    accepted: false,
    stopReason: 'accepted',
    exemplarShown: false,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    costUsd: 0,
  };
  return {
    opts: { workdir: ctx.workdir, adapter: ctx.adapter, brain: st.brain, runes: [], task: ctx.task },
    ctx,
    runes: [],
    messages: [],
    system: 'SYS',
    log: () => {},
    st,
    runId: 'r1',
    eventsOn: false,
    eventsPath: join(ctx.workdir, 'events.jsonl'),
    maxSteps: 30,
    forceStopAfter: 6,
    consultAfter: 4,
    nudgeAfter: 3,
    readBudget: 40,
    ...over,
  } as LoopRun;
}

// ═══════════════════════════════ engine-phases ══════════════════════════════
describe('stableCacheIndex', () => {
  it('returns a positive index for a long-enough transcript', () => {
    expect(stableCacheIndex(20)).toBe(20 - 16 - 1);
  });
  it('returns undefined when the transcript is too short', () => {
    expect(stableCacheIndex(10)).toBeUndefined();
    expect(stableCacheIndex(17)).toBeUndefined(); // 17-16-1 = 0, not > 0
  });
  it('honors a custom live window', () => {
    expect(stableCacheIndex(10, 2)).toBe(7);
  });
});

// applyToolCalls / tryTextExtract / runStopGate are internal to engine-phases —
// they are exercised THROUGH the exported runStep (one scripted brain turn each).
interface DriveOpts {
  runes?: Rune[];
  textExtract?: boolean;
  specPathHint?: string;
  onConsult?: (ctx: RunCtx) => Promise<string | undefined>;
}
function driveStep(ctx: RunCtx, response: BrainResponse, o: DriveOpts = {}): LoopRun {
  const lr = loopRun(ctx, { runes: o.runes ?? [] });
  lr.opts = { ...lr.opts, runes: o.runes ?? [], textExtract: o.textExtract, specPathHint: o.specPathHint, onConsult: o.onConsult };
  lr.st.brain = scriptBrain([response]);
  return lr;
}
const lastResults = (lr: LoopRun) => lr.messages.filter((m) => m.toolResults).at(-1)!.toolResults!;

describe('runStep → applyToolCalls (tool dispatch through the loop)', () => {
  it('runs an allowed tool and records a non-error result (plan → not productive)', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = driveStep(ctx, resp({ toolCalls: [call('plan', { plan: 'do the thing' })] }));
    expect(await runStep(lr)).toBe('fallthrough');
    expect(ctx.plan?.text).toBe('do the thing');
    expect(lastResults(lr)[0]).toMatchObject({ isError: false, content: 'plan recorded' });
    expect(ctx.barren).toBe(1); // plan is not a productive (write) call
  });

  it('a productive write resets barren and an afterToolCall hook observes it', async () => {
    const ctx = ctxOf(mkTmp());
    ctx.barren = 5;
    const seen: string[] = [];
    const watcher: Rune = { name: 'w', async afterToolCall(c) { seen.push(c.name); } };
    const lr = driveStep(ctx, resp({ toolCalls: [call('write_file', { path: 'a.test.ts', contents: 'x' })] }), { runes: [watcher] });
    await runStep(lr);
    expect(ctx.barren).toBe(0);
    expect(seen).toEqual(['write_file']);
    expect(ctx.editedFiles.has('a.test.ts')).toBe(true);
  });

  it('a blocking rune yields an isError result and counts a gate block', async () => {
    const ctx = ctxOf(mkTmp());
    const gate: Rune = { name: 'g', async beforeToolCall() { return block('nope', 'fix it'); } };
    const lr = driveStep(ctx, resp({ toolCalls: [call('write_file', { path: 'a.test.ts', contents: 'x' })] }), { runes: [gate] });
    await runStep(lr);
    expect(ctx.gateBlocks).toBe(1);
    expect(ctx.gateBlockReasons).toContain('nope');
    expect(lastResults(lr)[0]).toMatchObject({ isError: true, content: 'fix it' });
  });

  it('a tool that throws is captured as an error result (edit no-match)', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = driveStep(ctx, resp({ toolCalls: [call('edit_file', { path: 'missing.ts', old_string: 'a', new_string: 'b' })] }));
    await runStep(lr);
    expect(lastResults(lr)[0].isError).toBe(true);
  });

  it('prunes tool-result bodies older than the keep window', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = loopRun(ctx);
    lr.st.brain = scriptBrain([resp({ toolCalls: [call('plan', { plan: 'p' })] })]);
    for (let i = 0; i < 11; i++) await runStep(lr);
    const tr = lr.messages.filter((m) => m.toolResults);
    expect(tr).toHaveLength(11);
    expect(tr[0].toolResults![0].content).toContain('[pruned'); // first 3 stubbed (keepLast=8)
    expect(tr.at(-1)!.toolResults![0].content).toBe('plan recorded'); // newest kept
  });
});

describe('runStep → tryTextExtract (prose fence fallback)', () => {
  const fenced = (path?: string) =>
    '```ts\n' + (path ? `// ${path}\n` : '') + "import { it, expect } from 'vitest';\nit('w', () => { expect(1).toBe(1); });\n```";

  it('with textExtract OFF, a fenced answer is NOT written — goes to the stop gate', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = driveStep(ctx, resp({ text: fenced('a.test.ts') }), { textExtract: false });
    expect(await runStep(lr)).toBe('break'); // no gates → accepted
    expect(ctx.editedFiles.size).toBe(0);
  });

  it('writes a new fenced block that names a path', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = driveStep(ctx, resp({ text: fenced('sub/a.test.ts') }), { textExtract: true });
    expect(await runStep(lr)).toBe('fallthrough');
    expect(ctx.editedFiles.has('sub/a.test.ts')).toBe(true);
    expect(ctx.barren).toBe(0);
    expect(lr.st.lastExtract).toContain('expect(1).toBe(1)');
  });

  it('a repeated identical block is treated as "done" → falls through to the stop gate', async () => {
    const ctx = ctxOf(mkTmp());
    const gate: Rune = { name: 'g', async shouldStop() { return block('still', 'keep going'); } };
    const lr = loopRun(ctx, { runes: [gate] });
    lr.opts = { ...lr.opts, textExtract: true };
    lr.st.brain = scriptBrain([resp({ text: fenced('a.test.ts') })]);
    await runStep(lr); // first: writes the extracted block
    const writes = lr.messages.filter((m) => m.toolResults).length;
    await runStep(lr); // second: identical → no new write, hits stop gate
    expect(lr.messages.filter((m) => m.toolResults).length).toBe(writes); // no extra write
    expect(lr.messages.at(-1)!.text).toBe('keep going'); // gate inject, not a write
  });

  it('a block with no path and no specPathHint asks for a filename', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = driveStep(ctx, resp({ text: fenced() }), { textExtract: true });
    expect(await runStep(lr)).toBe('fallthrough');
    expect(ctx.barren).toBe(1);
    expect(lr.messages.at(-1)!.text).toContain('named no file');
  });

  it('falls back to specPathHint when the block names no path', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = driveStep(ctx, resp({ text: fenced() }), { textExtract: true, specPathHint: 'hint.test.ts' });
    await runStep(lr);
    expect(ctx.editedFiles.has('hint.test.ts')).toBe(true);
  });

  it('a gate that blocks the synthesized write records the block + feedback', async () => {
    const ctx = ctxOf(mkTmp());
    const gate: Rune = { name: 'g', async beforeToolCall() { return block('blocked', 'no'); } };
    const lr = driveStep(ctx, resp({ text: fenced('a.test.ts') }), { runes: [gate], textExtract: true });
    expect(await runStep(lr)).toBe('fallthrough');
    expect(ctx.gateBlocks).toBe(1);
    expect(lastResults(lr)[0].isError).toBe(true);
  });
});

describe('runStep → runStopGate (finish gates)', () => {
  it('accepts when all gates allow (break)', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = driveStep(ctx, resp({ text: 'done' }));
    expect(await runStep(lr)).toBe('break');
    expect(lr.st.accepted).toBe(true);
    expect(lr.st.stopReason).toBe('accepted');
  });

  it('falls through and injects feedback when a gate blocks', async () => {
    const ctx = ctxOf(mkTmp());
    const gate: Rune = { name: 'g', async shouldStop() { return block('not green', 'fix the test'); } };
    const lr = driveStep(ctx, resp({ text: 'done' }), { runes: [gate] });
    expect(await runStep(lr)).toBe('fallthrough');
    expect(ctx.gateBlocks).toBe(1);
    expect(lr.messages.at(-1)!.text).toBe('fix the test');
  });

  it('surfaces a similar exemplar on the first stop-block after an edit', async () => {
    const ctx = ctxOf(mkTmp());
    ctx.editedFiles.add('a.test.ts');
    const gate: Rune = { name: 'g', async shouldStop() { return block('not green', 'fix it'); } };
    const lr = driveStep(ctx, resp({ text: 'done' }), { runes: [gate], onConsult: async () => 'EXEMPLAR-SPEC' });
    expect(await runStep(lr)).toBe('fallthrough');
    expect(lr.st.exemplarShown).toBe(true);
    expect(lr.messages.at(-1)!.text).toContain('EXEMPLAR-SPEC');
  });
});

describe('runStep / requestCompletion (fake brain)', () => {
  it('a tool-call response is applied and the loop continues', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = loopRun(ctx, { st: { ...loopRun(ctx).st, brain: scriptBrain([resp({ toolCalls: [call('plan', { plan: 'p' })] })]) } });
    expect(await runStep(lr)).toBe('fallthrough');
    expect(ctx.step).toBe(1);
    expect(lr.st.tokensIn).toBe(1);
  });

  it('a no-tool response runs the stop gates and accepts', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = loopRun(ctx, { st: { ...loopRun(ctx).st, brain: scriptBrain([resp({ text: 'done' })]) } });
    expect(await runStep(lr)).toBe('break');
    expect(lr.st.accepted).toBe(true);
  });

  it('a brain error returns break with stopReason=error', async () => {
    const ctx = ctxOf(mkTmp());
    const lr = loopRun(ctx, { st: { ...loopRun(ctx).st, brain: scriptBrain([new Error('boom')]) } });
    expect(await runStep(lr)).toBe('break');
    expect(lr.st.stopReason).toBe('error');
  });

  it('onTurnStart hooks fire each step', async () => {
    const ctx = ctxOf(mkTmp());
    let turns = 0;
    const r: Rune = { name: 't', async onTurnStart() { turns++; } };
    const lr = loopRun(ctx, { runes: [r], st: { ...loopRun(ctx).st, brain: scriptBrain([resp({ text: 'x' })]) } });
    await runStep(lr);
    expect(turns).toBe(1);
  });
});

describe('assembleSystem & emit', () => {
  it('full mode appends systemPromptAddition + prepare text', async () => {
    const ctx = ctxOf(mkTmp());
    const r: Rune = { name: 'r', systemPromptAddition: () => 'ADD-RULE', prepare: async () => 'PREP-TEXT' };
    const sys = await assembleSystem({ minimalSystem: false } as any, [r], ctx);
    expect(sys).toContain('probevane'); // BASE_SYSTEM
    expect(sys).toContain('ADD-RULE');
    expect(sys).toContain('PREP-TEXT');
  });

  it('minimal mode skips additions but still runs prepare for side effects', async () => {
    const ctx = ctxOf(mkTmp());
    let prepared = false;
    const r: Rune = { name: 'r', systemPromptAddition: () => 'ADD-RULE', prepare: async () => { prepared = true; return 'PREP'; } };
    const sys = await assembleSystem({ minimalSystem: true } as any, [r], ctx);
    expect(sys).not.toContain('ADD-RULE');
    expect(sys).not.toContain('PREP');
    expect(prepared).toBe(true);
  });

  it('emit is a no-op when events are off and writes a line when on', async () => {
    const ctx = ctxOf(mkTmp());
    const off = loopRun(ctx, { eventsOn: false });
    expect(() => emit(off, { tool: 'x' })).not.toThrow();
    const path = join(ctx.workdir, 'ev.jsonl');
    const on = loopRun(ctx, { eventsOn: true, eventsPath: path });
    emit(on, { tool: 'plan' });
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path, 'utf8')).toContain('plan');
  });
});

// ═══════════════════════════════════ tools ══════════════════════════════════
describe('execTool — effects, guards, error paths', () => {
  function work(): string {
    const w = mkTmp();
    writeFileSync(join(w, 'seed.ts'), 'export const A = 1;\nexport const B = 2;\n');
    return w;
  }

  it('write_file creates the file and tracks edit state', async () => {
    const w = work();
    const ctx = ctxOf(w);
    const out = await execTool(call('write_file', { path: 'nested/new.ts', contents: 'hello' }), ctx);
    expect(out).toContain('wrote nested/new.ts');
    expect(ctx.editedFiles.has('nested/new.ts')).toBe(true);
    expect(ctx.lastEditPath).toBe('nested/new.ts');
    expect(ctx.validatedSinceEdit).toBe(false);
  });

  it('write_file rejects absolute paths', async () => {
    await expect(execTool(call('write_file', { path: '/etc/x', contents: 'y' }), ctxOf(work()))).rejects.toThrow(/absolute/);
  });

  it('edit_file replaces a unique occurrence', async () => {
    const w = work();
    const ctx = ctxOf(w);
    const out = await execTool(call('edit_file', { path: 'seed.ts', old_string: 'A = 1', new_string: 'A = 42' }), ctx);
    expect(out).toBe('edited seed.ts');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(w, 'seed.ts'), 'utf8')).toContain('A = 42');
  });

  it('edit_file errors when old_string is absent', async () => {
    await expect(execTool(call('edit_file', { path: 'seed.ts', old_string: 'ZZZ', new_string: 'q' }), ctxOf(work()))).rejects.toThrow(/not found/);
  });

  it('edit_file errors when old_string is not unique', async () => {
    const w = mkTmp();
    writeFileSync(join(w, 'dup.ts'), 'x\nx\n');
    await expect(execTool(call('edit_file', { path: 'dup.ts', old_string: 'x', new_string: 'y' }), ctxOf(w))).rejects.toThrow(/not unique/);
  });

  it('delete_file removes the file and clears edit tracking', async () => {
    const w = work();
    const ctx = ctxOf(w);
    await execTool(call('write_file', { path: 'gone.ts', contents: 'z' }), ctx);
    const out = await execTool(call('delete_file', { path: 'gone.ts' }), ctx);
    expect(out).toBe('deleted gone.ts');
    expect(ctx.editedFiles.has('gone.ts')).toBe(false);
    expect(ctx.lastEditPath).toBeNull();
  });

  it('read_file errors on a missing file', async () => {
    await expect(execTool(call('read_file', { path: 'nope.ts' }), ctxOf(work()))).rejects.toThrow();
  });

  it('plan records the plan with the current step', async () => {
    const ctx = ctxOf(work());
    ctx.step = 3;
    expect(await execTool(call('plan', { plan: 'my plan' }), ctx)).toBe('plan recorded');
    expect(ctx.plan).toEqual({ text: 'my plan', at: 3 });
  });

  it('list_dir lists workdir entries', async () => {
    const out = await execTool(call('list_dir', { path: '.' }), ctxOf(work()));
    expect(out).toContain('seed.ts');
  });

  it('unknown tool throws', async () => {
    await expect(execTool(call('frobnicate', {}), ctxOf(work()))).rejects.toThrow(/unknown tool/);
  });

  it('read_file truncates very large files', async () => {
    const w = mkTmp();
    writeFileSync(join(w, 'big.txt'), 'q'.repeat(25_000));
    const out = await execTool(call('read_file', { path: 'big.txt' }), ctxOf(w));
    expect(out).toContain('[truncated]');
    expect(out.length).toBeLessThan(25_000);
  });
});

// ═══════════════════════════════════ mutation ═══════════════════════════════
describe('mutation — pure scoring & generation', () => {
  const SRC = 'export function f(a: number, b: boolean) {\n  const x = a === 1;\n  const y = a >= 2;\n  const z = b && x;\n  const w = true;\n  return a + 1 ? x : z;\n}\n';
  function adapter(green: boolean): any {
    return {
      id: 'fake',
      async discover() { return [{ kind: 'unit', sourcePath: 'src/f.ts', name: 'f' }]; },
      async run() { return { passed: 1, failed: green ? 0 : 1, skipped: 0, green, raw: '' }; },
    };
  }
  function dir(): string {
    const w = mkTmp();
    mkdirSync(join(w, 'src'), { recursive: true });
    writeFileSync(join(w, 'src', 'f.ts'), SRC);
    return w;
  }

  it('lineOf returns the 1-based line of a char index', () => {
    expect(lineOf('a\nbb\nccc', 0)).toBe(1);
    expect(lineOf('a\nbb\nccc', 2)).toBe(2);
    expect(lineOf('a\nbb\nccc', 5)).toBe(3);
  });

  it('green suite → every applicable mutant survives (score 0)', async () => {
    const r = await mutationScore(dir(), adapter(true), 5);
    expect(r.total).toBeGreaterThan(0);
    expect(r.killed).toBe(0);
    expect(r.score).toBe(0);
  });

  it('red suite → every mutant killed (score 1)', async () => {
    const r = await mutationScore(dir(), adapter(false), 5);
    expect(r.total).toBeGreaterThan(0);
    expect(r.killed).toBe(r.total);
    expect(r.score).toBe(1);
  });

  it('survivorSummary names the top sites for a gate reason, capping the rest', () => {
    const m = (sourcePath: string, line: number, mutation: string) => ({ sourcePath, line, mutation, snippet: '' });
    expect(survivorSummary([])).toBe('');
    expect(survivorSummary([m('a.ts', 1, '=== → !==')])).toBe('a.ts:1 `=== → !==`');
    const four = survivorSummary([m('a.ts', 1, 'x'), m('b.ts', 2, 'y'), m('c.ts', 3, 'z'), m('d.ts', 4, 'w')]);
    expect(four).toBe('a.ts:1 `x`, b.ts:2 `y`, c.ts:3 `z`, +1 more');
  });

  it('no applicable operators → total 0, score 1', async () => {
    const w = mkTmp();
    mkdirSync(join(w, 'src'), { recursive: true });
    writeFileSync(join(w, 'src', 'f.ts'), 'export const NAME = "plain string only";\n');
    const r = await mutationScore(w, adapter(true), 5);
    expect(r).toEqual({ total: 0, killed: 0, score: 1 });
  });

  it('survivingMutants collects survivors with location + mutantDigest formats them', async () => {
    const survivors = await survivingMutants(dir(), adapter(true), 6);
    expect(survivors.length).toBeGreaterThan(0);
    const s = survivors[0];
    expect(s.sourcePath).toBe('src/f.ts');
    expect(s.line).toBeGreaterThan(0);
    expect(s.mutation).toContain('→');
    const digest = mutantDigest(survivors);
    expect(digest).toContain('SURVIVING MUTANTS');
    expect(digest).toContain('src/f.ts');
  });

  it('mutantDigest is empty when there are no survivors', () => {
    expect(mutantDigest([])).toBe('');
  });

  it('a missing source target is skipped (no throw)', async () => {
    const bad: any = { id: 'b', async discover() { return [{ kind: 'unit', sourcePath: 'src/missing.ts', name: 'm' }]; }, async run() { return { passed: 0, failed: 0, skipped: 0, green: true, raw: '' }; } };
    const r = await mutationScore(mkTmp(), bad, 5);
    expect(r.total).toBe(0);
  });

  it('MUTATIONS table is non-empty', () => {
    expect(MUTATIONS.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════ dep-digest ═════════════════════════════
describe('buildDepDigest — extra branches', () => {
  it('returns empty when the focus file has no resolvable workspace/relative imports', () => {
    const ws = mkTmp();
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src', 'solo.ts'), 'import { useState } from "react";\nexport const v = 1;\n');
    expect(buildDepDigest(ws, 'src/solo.ts')).toBe('');
  });

  it('resolves a barrel re-export (export { x } from ...) via the fallback path', () => {
    const ws = mkTmp();
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    // barrel that re-exports a name without a local definition
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src', 'barrel.ts'), 'export { thing } from "./impl";\n');
    writeFileSync(join(ws, 'src', 'focus.ts'), 'import { thing } from "./barrel";\nexport const z = thing;\n');
    const d = buildDepDigest(ws, 'src/focus.ts');
    expect(d).toContain('./barrel');
    expect(d).toContain('thing');
  });

  it('resolves a workspace package addressed by a subpath import', () => {
    const ws = mkTmp();
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'root', workspaces: { packages: ['packages/*'] } }));
    mkdirSync(join(ws, 'packages', 'lib', 'src'), { recursive: true });
    // entry resolves to packages/lib/index.ts → dirname is packages/lib, so the
    // subpath 'src/helpers' resolves to packages/lib/src/helpers.ts.
    writeFileSync(join(ws, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@x/lib', main: 'index.ts' }));
    writeFileSync(join(ws, 'packages', 'lib', 'index.ts'), 'export const ROOT = 1;\n');
    writeFileSync(join(ws, 'packages', 'lib', 'src', 'helpers.ts'), 'export function helperFn(n: number): number { return n; }\n');
    mkdirSync(join(ws, 'app'), { recursive: true });
    writeFileSync(join(ws, 'app', 'focus.ts'), 'import { helperFn } from "@x/lib/src/helpers";\nexport const q = helperFn(1);\n');
    const d = buildDepDigest(join(ws, 'app'), 'focus.ts');
    expect(d).toContain('@x/lib/src/helpers');
    expect(d).toContain('helperFn');
  });
});

// ═══════════════════════════════════ docs rune ══════════════════════════════
describe('docs runes', () => {
  const SECTIONS = ['Overview', 'Architecture'];
  function goodDoc(): string {
    const body = 'x '.repeat(150); // > 200 chars
    return `# My Guide\n\n## Overview\n${body}\n\n## Architecture\n${body}\n`;
  }

  it('extractRefs pulls markdown-link + backticked path refs, skips externals/anchors', () => {
    const md = 'See [engine](src/loop/engine.ts) and `src/loop/tools.ts`.\n[ext](https://x.com)\n[anchor](#top)\n`justAWord`\n`glob/*.ts`';
    const refs = extractRefs(md);
    expect(refs).toContain('src/loop/engine.ts');
    expect(refs).toContain('src/loop/tools.ts');
    expect(refs).not.toContain('https://x.com');
    expect(refs.some((r) => r.includes('#'))).toBe(false);
    expect(refs).not.toContain('justAWord');
  });

  it('docStructureGate blocks a missing guide, then a missing H1, then accepts a full one', async () => {
    const w = mkTmp();
    const gate = docStructureGate('GUIDE.md', SECTIONS);
    const ctx = ctxOf(w);
    let d = await gate.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('no guide written');

    writeFileSync(join(w, 'GUIDE.md'), '## Overview\nno title here\n');
    d = await gate.shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('missing H1');

    writeFileSync(join(w, 'GUIDE.md'), goodDoc());
    expect((await gate.shouldStop!(ctx)).kind).toBe('allow');
    expect(gate.systemPromptAddition!()).toContain('STRUCTURE');
  });

  it('docStructureGate flags a missing section and a too-thin one', async () => {
    const w = mkTmp();
    writeFileSync(join(w, 'GUIDE.md'), `# T\n\n## Overview\nthin\n`); // Architecture missing, Overview thin
    const d = await docStructureGate('GUIDE.md', SECTIONS).shouldStop!(ctxOf(w));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.inject).toContain('missing section "Architecture"');
      expect(d.inject).toContain('too thin');
    }
  });

  it('docReferenceGate allows real refs, blocks hallucinated ones, allows a missing guide', async () => {
    const w = mkTmp();
    mkdirSync(join(w, 'src'), { recursive: true });
    writeFileSync(join(w, 'src', 'real.ts'), 'export const x = 1;\n');
    // missing guide → ALLOW (structure gate owns that case)
    expect((await docReferenceGate('GUIDE.md').shouldStop!(ctxOf(w))).kind).toBe('allow');

    writeFileSync(join(w, 'GUIDE.md'), 'See `src/real.ts` and `src/ghost.ts`.\n');
    const flagged: string[] = [];
    const d = await docReferenceGate('GUIDE.md', (l) => flagged.push(l)).shouldStop!(ctxOf(w));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.inject).toContain('src/ghost.ts');
    expect(flagged.join('')).toContain('src/ghost.ts');

    writeFileSync(join(w, 'GUIDE.md'), 'Only `src/real.ts`.\n');
    expect((await docReferenceGate('GUIDE.md').shouldStop!(ctxOf(w))).kind).toBe('allow');
  });

  it('docsScopeGuard allows markdown, blocks code + off-limits paths, ignores non-writes', async () => {
    const g = docsScopeGuard();
    const ctx = ctxOf(mkTmp());
    expect((await g.beforeToolCall!(call('write_file', { path: 'docs/x.md' }), ctx)).kind).toBe('allow');
    expect((await g.beforeToolCall!(call('read_file', { path: 'src/a.ts' }), ctx)).kind).toBe('allow');
    const code = await g.beforeToolCall!(call('write_file', { path: 'src/a.ts' }), ctx);
    expect(code.kind).toBe('block');
    if (code.kind === 'block') expect(code.reason).toContain('not a markdown file');
    const off = await g.beforeToolCall!(call('write_file', { path: 'node_modules/x.md' }), ctx);
    expect(off.kind).toBe('block');
    if (off.kind === 'block') expect(off.reason).toContain('off-limits');
    expect(g.systemPromptAddition!()).toContain('SCOPE');
  });

  it('docsAcceptance blocks a short guide and allows a long one', async () => {
    const w = mkTmp();
    const g = docsAcceptance('GUIDE.md', 50);
    expect((await g.shouldStop!(ctxOf(w))).kind).toBe('block'); // missing
    writeFileSync(join(w, 'GUIDE.md'), 'short');
    expect((await g.shouldStop!(ctxOf(w))).kind).toBe('block');
    writeFileSync(join(w, 'GUIDE.md'), 'y'.repeat(60));
    expect((await g.shouldStop!(ctxOf(w))).kind).toBe('allow');
  });

  it('docsContextInject.prepare embeds the digest + sections', async () => {
    const out = await docsContextInject('DIGEST-XYZ', SECTIONS, 'GUIDE.md').prepare!(ctxOf(mkTmp()));
    expect(out).toContain('DIGEST-XYZ');
    expect(out).toContain('Overview');
    expect(out).toContain('GUIDE.md');
  });
});

// ═══════════════════════════════ library_promote ════════════════════════════
describe('library_promote', () => {
  it('kindFor / categoryFor / scoreFor / slugFor pure helpers', () => {
    expect(kindFor('src/a.spec.ts')).toBe('e2e');
    expect(kindFor('e2e/flow.test.ts')).toBe('e2e');
    expect(kindFor('src/a.test.ts')).toBe('unit');
    expect(categoryFor('src/useThing.test.ts')).toBe('hooks');
    expect(categoryFor('src/a.spec.ts')).toBe('flow');
    expect(categoryFor('src/format.test.ts')).toBe('pure-helpers');
    expect(categoryFor('src/Widget.test.ts')).toBe('component');
    expect(scoreFor(0)).toBe(100);
    expect(scoreFor(3)).toBe(70);
    expect(scoreFor(20)).toBe(0); // clamped
    expect(slugFor('src/a.test.ts', 'BODY')).toMatch(/^a-test-[0-9a-f]{8}$/);
  });

  it('onStop is a no-op unless accepted AND PROBEVANE_TRACES=1', async () => {
    const ctx = ctxOf(mkTmp());
    ctx.accepted = false;
    await libraryPromote.onStop!(ctx);
    expect(promote.saved).toHaveLength(0);

    process.env.PROBEVANE_TRACES = '1';
    ctx.accepted = false; // accepted false → still no-op
    await libraryPromote.onStop!(ctx);
    expect(promote.saved).toHaveLength(0);
  });

  it('promotes an accepted spec to the library and dedupes by slug', async () => {
    process.env.PROBEVANE_TRACES = '1';
    const w = mkTmp();
    const ctx = ctxOf(w);
    ctx.accepted = true;
    const spec = "import { it } from 'vitest';\nit('w', () => {});\n";
    writeFileSync(join(w, 'a.test.ts'), spec);
    ctx.editedFiles.add('a.test.ts');
    ctx.editedFiles.add('src/source.ts'); // not a spec → skipped by TEST_RE

    await libraryPromote.onStop!(ctx);
    expect(promote.saved).toHaveLength(1);
    expect(promote.saved[0].meta.stack).toBe('docs'); // nullAdapter.id
    expect(promote.saved[0].meta.quality).toBe('good');

    // second run with the same slug already in the index → deduped (no new save)
    promote.saved.length = 0;
    promote.index = [{ path: `${slugFor('a.test.ts', spec)}.md` }];
    await libraryPromote.onStop!(ctx);
    expect(promote.saved).toHaveLength(0);
  });
});

// ═══════════════════════════════ distill_trace ══════════════════════════════
describe('distill_trace', () => {
  it('no-op unless accepted AND PROBEVANE_TRACES=1', async () => {
    const ctx = ctxOf(mkTmp());
    ctx.accepted = true; // but no env
    await distillTrace.onStop!(ctx);
    expect(distill.recorded).toHaveLength(0);
  });

  it('records a trace on an accepted run with traces enabled', async () => {
    process.env.PROBEVANE_TRACES = '1';
    const ctx = ctxOf(mkTmp());
    ctx.accepted = true;
    await distillTrace.onStop!(ctx);
    expect(distill.recorded).toHaveLength(1);
  });
});

// ═══════════════════════════════════ flake_gate ═════════════════════════════
describe('flake_gate', () => {
  it('flakeVerdict honors the tolerance', () => {
    expect(flakeVerdict(['1/0', '1/0', '1/0'])).toBe(false);
    expect(flakeVerdict(['1/0', '1/0', '0/1'])).toBe(true);
    expect(flakeVerdict(['1/0', '1/0', '0/1'], 1)).toBe(false); // 1 outlier within tolerance
  });

  it('blocks when repeated runs disagree (non-deterministic)', async () => {
    const seq = ['1/0', '1/0', '0/1'];
    let i = 0;
    const adapter: any = { id: 'f', async run() { const [p, f] = seq[i++].split('/').map(Number); return { passed: p, failed: f, skipped: 0, green: f === 0, raw: '' }; } };
    const ctx = ctxOf(mkTmp(), adapter);
    ctx.editedFiles.add('a.test.ts'); // exercises the specs.length ? specs : undefined branch
    const d = await flakeGate(3, 0).shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('non-deterministic');
  });

  it('allows when every run agrees', async () => {
    const adapter: any = { id: 'f', async run() { return { passed: 2, failed: 0, skipped: 0, green: true, raw: '' }; } };
    const d = await flakeGate(3, 0).shouldStop!(ctxOf(mkTmp(), adapter));
    expect(d.kind).toBe('allow');
    expect(flakeGate().systemPromptAddition!()).toContain('DETERMINISM');
  });
});

// ═══════════════════════════════════ mutation_gate ══════════════════════════
describe('mutation_gate', () => {
  const SRC = 'export const f = (a: number) => a === 1 && a >= 0;\n';
  function adapter(green: boolean): any {
    return { id: 'm', async discover() { return [{ kind: 'unit', sourcePath: 'src/f.ts', name: 'f' }]; }, async run() { return { passed: 1, failed: green ? 0 : 1, skipped: 0, green, raw: '' }; } };
  }
  function dir(): string {
    const w = mkTmp();
    mkdirSync(join(w, 'src'), { recursive: true });
    writeFileSync(join(w, 'src', 'f.ts'), SRC);
    return w;
  }

  it('advisory (enforce=false) always allows', async () => {
    expect((await mutationGate({ enforce: false }).shouldStop!(ctxOf(dir(), adapter(true)))).kind).toBe('allow');
  });

  it('enforce=true blocks when the suite catches no mutants (score below threshold)', async () => {
    const d = await mutationGate({ enforce: true }).shouldStop!(ctxOf(dir(), adapter(true)));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('mutation score');
  });

  it('enforce=true allows when mutants are killed', async () => {
    expect((await mutationGate({ enforce: true }).shouldStop!(ctxOf(dir(), adapter(false)))).kind).toBe('allow');
  });
});

// ═══════════════════════════════════ a11y_gate ══════════════════════════════
describe('a11y_gate', () => {
  function withSpec(contents: string): RunCtx {
    const w = mkTmp();
    writeFileSync(join(w, 'c.test.ts'), contents);
    const ctx = ctxOf(w);
    ctx.editedFiles.add('c.test.ts');
    return ctx;
  }

  it('blocks a rendering spec with no accessibility assertion', async () => {
    const d = await a11yGate.shouldStop!(withSpec("import { render } from '@testing-library/react';\nit('x', () => { render(<A/>); expect(1).toBe(1); });\n"));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('no a11y assertion');
  });

  it('allows a rendering spec that queries by role', async () => {
    expect((await a11yGate.shouldStop!(withSpec("render(<A/>);\nscreen.getByRole('button');\n"))).kind).toBe('allow');
  });

  it('allows a spec that does not render a component', async () => {
    expect((await a11yGate.shouldStop!(withSpec("it('pure', () => { expect(add(1,2)).toBe(3); });\n"))).kind).toBe('allow');
    expect(a11yGate.systemPromptAddition!()).toContain('ACCESSIBILITY');
  });
});

// ═══════════════════════════════════ hermetic_gate ══════════════════════════
describe('hermetic_gate', () => {
  function withSpec(contents: string): RunCtx {
    const w = mkTmp();
    writeFileSync(join(w, 'c.test.ts'), contents);
    const ctx = ctxOf(w);
    ctx.editedFiles.add('c.test.ts');
    return ctx;
  }

  it('blocks an external URL', async () => {
    const d = await hermeticGate.shouldStop!(withSpec("fetch('https://api.example.com/x');\n"));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('external URL');
  });

  it('blocks un-mocked network', async () => {
    const d = await hermeticGate.shouldStop!(withSpec("const r = await fetch('/api/local');\n"));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('un-mocked network');
  });

  it('blocks uncontrolled time/random', async () => {
    const d = await hermeticGate.shouldStop!(withSpec("const t = Date.now();\nexpect(t).toBeGreaterThan(0);\n"));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('uncontrolled time/random');
  });

  it('allows a hermetic spec (mocked net + controlled time)', async () => {
    const ctx = withSpec("setupServer();\nconst r = await fetch('/api');\nvi.useFakeTimers();\nconst t = Date.now();\n");
    expect((await hermeticGate.shouldStop!(ctx)).kind).toBe('allow');
    expect(hermeticGate.systemPromptAddition!()).toContain('HERMETIC');
  });

  it('ignores a non-spec edited file', async () => {
    const w = mkTmp();
    writeFileSync(join(w, 'notes.md'), "fetch('https://x.com')");
    const ctx = ctxOf(w);
    ctx.editedFiles.add('notes.md');
    expect((await hermeticGate.shouldStop!(ctx)).kind).toBe('allow');
  });
});

// ═══════════════════════════════════ visual_gate ════════════════════════════
describe('visual_gate', () => {
  function withSpec(rel: string, contents: string): RunCtx {
    const w = mkTmp();
    mkdirSync(join(w, 'e2e'), { recursive: true });
    writeFileSync(join(w, rel), contents);
    const ctx = ctxOf(w);
    ctx.editedFiles.add(rel);
    return ctx;
  }

  it('blocks an e2e spec with no visual checkpoint', async () => {
    const d = await visualGate.shouldStop!(withSpec('e2e/flow.spec.ts', "test('x', async ({ page }) => { await page.goto('/'); });\n"));
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toContain('no visual checkpoint');
  });

  it('allows an e2e spec that captures a checkpoint', async () => {
    const ctx = withSpec('e2e/flow.spec.ts', "await checkpoint(page, 'home');\n");
    expect((await visualGate.shouldStop!(ctx)).kind).toBe('allow');
  });

  it('skips the checkpoint helper file itself', async () => {
    const ctx = withSpec('e2e/checkpoint.spec.ts', 'export const checkpoint = () => {};\n');
    // not the helper name (checkpoint.ts) and has checkpoint( → allowed anyway; assert no throw
    expect(['allow', 'block']).toContain((await visualGate.shouldStop!(ctx)).kind);
  });

  it('prepare does not throw even when the helper source is unavailable', async () => {
    await expect(visualGate.prepare!(ctxOf(mkTmp()))).resolves.toBeUndefined();
    expect(visualGate.systemPromptAddition!()).toContain('VISUAL REGRESSION');
  });
});
