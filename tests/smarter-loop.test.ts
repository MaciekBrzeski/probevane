import { describe, it, expect } from 'vitest';
import { isCircular, proposal, CIRCULAR_THRESHOLD } from '../src/loop/difficulty.js';
import { stableCacheIndex } from '../src/loop/engine.js';
import { toApiMsg, withCacheBreakpoint } from '../src/brain/anthropic-sdk.js';
import { tokenize, similarity, pickSimilarTrace } from '../src/library/similar.js';
import { kindFor, categoryFor, scoreFor, slugFor } from '../src/loop/runes/library_promote.js';
import { extractTestBlock, conventionalSpecPath } from '../src/loop/extract.js';
import { parseDecision, extractJson } from '../src/brain/claude-code.js';
import { summarize, type RunRecord } from '../src/cost/ledger.js';
import { toResponse } from '../src/brain/bridge.js';
import { RunCtx } from '../src/loop/ctx.js';
import { hermeticGate } from '../src/loop/runes/hermetic_gate.js';
import { auditGate } from '../src/loop/runes/audit_gate.js';
import { jsAuditRules } from '../src/audit/rules-js.js';
import { firstFailure } from '../src/loop/runes/validation_gate.js';
import { isEasyTarget, factDensity, routeTargets } from '../src/loop/triage.js';
import { simulateCost, savings, MEASURED } from '../src/cost/simulate.js';
import { factDigest } from '../src/loop/fact-digest.js';
import { propertyGuidance, looksPropertyTestable } from '../src/loop/property.js';
import { runPool } from '../src/util/concurrent.js';
import { lineOf, mutantDigest } from '../src/loop/mutation.js';
import { scoreAssertions, aggregateScore } from '../src/audit/assertion-score.js';
import { impactedSpecs, reachesAny } from '../src/loop/impact.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Trace } from '../src/distill/collect.js';

// ---- Difficulty gate --------------------------------------------------------
describe('difficulty.isCircular', () => {
  it('fires when one gate-block reason repeats >= threshold', () => {
    const s = { gateBlockHistory: ['validation_gate', 'validation_gate', 'validation_gate'], recentCalls: [] };
    expect(isCircular(s)).toBe(true);
  });
  it('fires when an identical tool call repeats >= threshold', () => {
    const sig = 'read_file:{"path":"src/x.ts"}';
    expect(isCircular({ gateBlockHistory: [], recentCalls: [sig, sig, sig] })).toBe(true);
  });
  it('stays quiet when nothing repeats enough', () => {
    const s = { gateBlockHistory: ['audit_gate', 'validation_gate'], recentCalls: ['read_file:{"path":"a"}', 'read_file:{"path":"b"}'] };
    expect(isCircular(s)).toBe(false);
  });
  it('threshold is 3', () => expect(CIRCULAR_THRESHOLD).toBe(3));

  it('proposal names the dominant blocker and a next step', () => {
    const p = proposal({ gateBlockHistory: ['audit_gate', 'audit_gate', 'audit_gate', 'audit_gate'], recentCalls: [] });
    expect(p).toContain('audit_gate');
    expect(p).toContain('×4');
    expect(p).toMatch(/split|max-steps|simpler/);
  });
  it('proposal names a repeated tool call by name (not raw JSON)', () => {
    const sig = 'edit_file:{"path":"src/y.ts","old":"a"}';
    const p = proposal({ gateBlockHistory: [], recentCalls: [sig, sig, sig] });
    expect(p).toContain('edit_file');
    expect(p).not.toContain('"old"');
  });

  it('catches the never-edited stall: same stop-block repeating is circular', () => {
    // A weak local model that never calls write_file keeps hitting the same stop
    // gate; recentCalls may be empty, but the repeated block reason alone trips it.
    const ctx = new RunCtx('/tmp', {} as any, 'task');
    for (let i = 0; i < 8; i++) ctx.noteBlock('validation_gate: no test file was written');
    expect(ctx.editedFiles.size).toBe(0); // never edited
    expect(isCircular(ctx)).toBe(true);
    expect(proposal(ctx)).toContain('no test file was written');
  });

  it('RunCtx.noteBlock feeds the raw history the gate reads', () => {
    const ctx = new RunCtx('/tmp', {} as any, 'task');
    ctx.noteBlock('validation_gate');
    ctx.noteBlock('validation_gate');
    ctx.noteBlock('validation_gate');
    expect(ctx.gateBlockHistory).toHaveLength(3); // raw — repeats kept
    expect(ctx.gateBlockReasons).toHaveLength(1); // deduped
    expect(isCircular(ctx)).toBe(true);
  });
});

// ---- validation_gate sharper repair signal (loop investment) ----------------
describe('validation_gate.firstFailure', () => {
  it('extracts the first vitest failure + assertion', () => {
    const raw = ' ✓ cart.test.ts > sums\n ✗ cart.test.ts > applies discount\n   AssertionError: expected 90 to be 80\n    ❯ cart.test.ts:12:24\n ✓ cart.test.ts > rounds';
    const f = firstFailure(raw)!;
    expect(f).toContain('applies discount');
    expect(f).toContain('expected 90 to be 80');
    expect(f).not.toContain('rounds'); // stops near the first failure
  });
  it('extracts the first pytest failure', () => {
    const raw = 'test_calc.py::test_add PASSED\ntest_calc.py::test_sub FAILED\nE   assert 3 == 4\n';
    const f = firstFailure(raw)!;
    expect(f).toMatch(/FAILED|assert 3 == 4/);
  });
  it('returns undefined on green/empty output', () => {
    expect(firstFailure('')).toBeUndefined();
    expect(firstFailure('all tests passed, 5 ok')).toBeUndefined();
  });
});

// ---- test-impact analysis ---------------------------------------------------
describe('impact analysis', () => {
  // a → b → c chain
  const graph: any = { nodes: new Map([
    ['src/a.ts', { imports: ['src/b.ts'] }],
    ['src/b.ts', { imports: ['src/c.ts'] }],
    ['src/c.ts', { imports: [] }],
    ['src/z.ts', { imports: [] }],
  ]) };
  const specDeps = new Map([
    ['src/a.test.ts', ['src/a.ts']],
    ['src/z.test.ts', ['src/z.ts']],
  ]);
  it('reachesAny follows the transitive import chain', () => {
    expect(reachesAny(graph, ['src/a.ts'], new Set(['src/c.ts']))).toBe(true);
    expect(reachesAny(graph, ['src/z.ts'], new Set(['src/c.ts']))).toBe(false);
  });
  it('a transitive source change impacts the dependent spec only', () => {
    expect(impactedSpecs(graph, specDeps, ['src/c.ts'])).toEqual(['src/a.test.ts']);
  });
  it('a direct source change impacts its spec', () => {
    expect(impactedSpecs(graph, specDeps, ['src/z.ts'])).toEqual(['src/z.test.ts']);
  });
  it('the spec itself changing impacts it', () => {
    expect(impactedSpecs(graph, specDeps, ['src/a.test.ts'])).toContain('src/a.test.ts');
  });
  it('an unrelated change impacts nothing (CI skip)', () => {
    expect(impactedSpecs(graph, specDeps, ['src/other.ts'])).toEqual([]);
  });
});

// ---- assertion-quality scorer -----------------------------------------------
describe('assertion-score', () => {
  it('strong value assertions score 100', () => {
    const s = scoreAssertions(`it('x', () => { expect(add(1,2)).toBe(3); expect(list).toEqual([1,2]); });`);
    expect(s.score).toBe(100);
    expect(s.weak).toHaveLength(0);
  });
  it('flags existence-only, tautology, snapshot, bare not.toThrow', () => {
    const src = [
      `expect(x).toBeDefined();`,
      `expect(true).toBe(true);`,
      `expect(y).toMatchSnapshot();`,
      `expect(() => f()).not.toThrow();`,
    ].join('\n');
    const s = scoreAssertions(src);
    expect(s.weak.map((w) => w.kind).sort()).toEqual(['bare not.toThrow', 'existence/type-only', 'snapshot-only', 'tautology']);
    expect(s.score).toBe(0);
  });
  it('mixed file: 3 strong + 1 weak → 75', () => {
    const src = `expect(a).toBe(1)\nexpect(b).toEqual(2)\nexpect(c).toContain('x')\nexpect(d).toBeTruthy()`;
    expect(scoreAssertions(src).score).toBe(75);
  });
  it('a toBeDefined paired with a value check on the same line is not weak', () => {
    expect(scoreAssertions(`expect(x).toBeDefined(); expect(x.id).toBe(7)`).weak).toHaveLength(0);
  });
  it('aggregateScore rolls files up', () => {
    const a = aggregateScore([
      { file: 'a', s: scoreAssertions('expect(x).toBe(1)') },
      { file: 'b', s: scoreAssertions('expect(y).toBeDefined()') },
    ]);
    expect(a).toEqual({ score: 50, total: 2, weak: 1 });
  });
});

// ---- mutation-driven targeting ----------------------------------------------
describe('mutation targeting', () => {
  it('lineOf returns the 1-based line of an index', () => {
    const src = 'a\nbb\nccc';
    expect(lineOf(src, 0)).toBe(1); // 'a'
    expect(lineOf(src, 2)).toBe(2); // first char of 'bb'
    expect(lineOf(src, 5)).toBe(3); // 'ccc'
  });
  it('mutantDigest lists survivors with location + mutation; empty on none', () => {
    expect(mutantDigest([])).toBe('');
    const d = mutantDigest([{ sourcePath: 'src/x.ts', line: 12, mutation: '=== → !==', snippet: 'if (a === b) return 1;' }]);
    expect(d).toContain('SURVIVING MUTANTS');
    expect(d).toContain('src/x.ts:12');
    expect(d).toContain('=== → !==');
    expect(d).toMatch(/FAIL/);
  });
});

// ---- bounded-concurrency pool -----------------------------------------------
describe('util.runPool', () => {
  it('preserves order + runs everything', async () => {
    const r = await runPool([1, 2, 3, 4, 5], async (n) => n * 2, 2);
    expect(r).toEqual([2, 4, 6, 8, 10]);
  });
  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0, peak = 0;
    await runPool(Array.from({ length: 10 }, (_, i) => i), async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    }, 3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // actually parallel
  });
  it('handles empty + limit>items', async () => {
    expect(await runPool([], async (x) => x, 4)).toEqual([]);
    expect(await runPool([1], async (x) => x + 1, 8)).toEqual([2]);
  });
});

// ---- property / invariant testing -------------------------------------------
describe('property guidance', () => {
  it('teaches the core invariant patterns', () => {
    const g = propertyGuidance();
    expect(g).toMatch(/round-trip|inverse/);
    expect(g).toContain('idempotence');
    expect(g).toMatch(/it\.each/);
    expect(g).toMatch(/no exact expected value|do NOT guess/i);
  });
  it('looksPropertyTestable: pure fn yes, IO no', () => {
    expect(looksPropertyTestable('export function add(a:number,b:number){return a+b}')).toBe(true);
    expect(looksPropertyTestable('export const f = (x:number) => x*2')).toBe(true);
    expect(looksPropertyTestable('export async function load(id){return fetch("/x"+id)}')).toBe(false);
    expect(looksPropertyTestable('export function now(){return Date.now()}')).toBe(false);
  });
});

// ---- surgical fact-RAG ------------------------------------------------------
describe('fact-digest', () => {
  const SRC = `import { x } from './y';\nexport const RATES = { 'opus': { in: 5, out: 25 }, 'haiku': { in: 1, out: 5 } };\nexport interface Product { id: string; priceCents: number; inStock: boolean; }\nexport function rateFor(m: string) { return RATES[m]; }\nexport const MAX = 100;`;
  it('captures an exported const data table with nested braces', () => {
    const d = factDigest(SRC);
    expect(d).toContain('RATES');
    expect(d).toContain("'opus'");
    expect(d).toContain('out: 25'); // nested value kept (balanced)
  });
  it('captures a type/interface shape', () => {
    const d = factDigest(SRC);
    expect(d).toContain('interface Product');
    expect(d).toContain('priceCents');
  });
  it('captures a primitive const', () => {
    expect(factDigest(SRC)).toContain('MAX = 100');
  });
  it('omits function bodies (facts only) and stays capped', () => {
    const d = factDigest(SRC, { cap: 400 });
    expect(d.length).toBeLessThanOrEqual(400);
    expect(d).not.toContain('return RATES[m]'); // implementation excluded
  });
});

// ---- cost simulator ---------------------------------------------------------
describe('cost.simulateCost', () => {
  it('all-api = easy*easyApi + hard*hardApi (measured)', () => {
    const s = simulateCost({ easy: 10, hard: 5 }, 0.5);
    expect(s[0].name).toBe('all-api');
    expect(s[0].cost).toBeCloseTo(10 * MEASURED.easyApi + 5 * MEASURED.hardApi, 2); // 5.70
  });
  it('hybrid saves the local-hit fraction of easy cost', () => {
    const s = simulateCost({ easy: 10, hard: 5 }, 0.5);
    // hybrid = 10*0.5*0.16 + 5*0.82 = 0.8 + 4.1 = 4.9
    expect(s[1].cost).toBeCloseTo(4.9, 2);
    expect(s[2].cost).toBe(0); // bridge/local-only
  });
  it('localHitRate=1 zeroes the easy band; hard cost remains', () => {
    const s = simulateCost({ easy: 8, hard: 3 }, 1);
    expect(s[1].cost).toBeCloseTo(3 * MEASURED.hardApi, 2);
  });
  it('savings computes pct vs the all-api baseline', () => {
    const rows = savings(simulateCost({ easy: 10, hard: 0 }, 1));
    expect(rows[1].pct).toBe(100); // all-easy, full local → 100% saved
    expect(rows[0].pct).toBe(0);
  });
});

// ---- easy-band triage (local-drafter prototype) -----------------------------
describe('triage.isEasyTarget', () => {
  const tgt = (sourcePath: string, meta: any = {}): any => ({ sourcePath, name: 'x', kind: 'unit', meta });
  const PURE = `export function add(a: number, b: number): number { return a + b; }\nexport function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }`;
  const NETWORK = `import { x } from './y';\nexport async function load(id: string) { const r = await fetch('/api/' + id); return r.json(); }`;
  const FACTS = `export const RATES = { 'claude-opus-4-8': { in: 5, out: 25 }, 'claude-sonnet-4-6': { in: 3, out: 15 }, 'claude-haiku-4-5': { in: 1, out: 5 }, 'gpt-4': { in: 30, out: 60 } };\nexport function rateFor(m: string) { return RATES[m]; }`;

  it('pure low-fact helper → easy (score 0)', () => {
    const t = isEasyTarget(tgt('src/math.ts'), PURE);
    expect(t.easy).toBe(true);
    expect(t.score).toBe(0);
  });
  it('networked module → hard', () => {
    const t = isEasyTarget(tgt('src/api.ts'), NETWORK);
    expect(t.easy).toBe(false);
    expect(t.reasons).toContain('network/IO');
  });
  it('fact-heavy table → hard (local would invent the facts)', () => {
    const t = isEasyTarget(tgt('src/pricing.ts'), FACTS);
    expect(t.easy).toBe(false);
    expect(t.reasons.some((r) => r.includes('fact-heavy'))).toBe(true);
  });
  it('component (.tsx) → hard', () => {
    expect(isEasyTarget(tgt('src/Cart.tsx'), 'export const Cart = () => <div/>;').easy).toBe(false);
  });
  it('provider-heavy meta → hard', () => {
    expect(isEasyTarget(tgt('src/x.ts', { cost: 6 }), 'export function f(){return 1}').easy).toBe(false);
  });

  it('factDensity: pure ~0, rate-table high', () => {
    expect(factDensity(PURE)).toBeLessThan(5);
    expect(factDensity(FACTS)).toBeGreaterThan(10);
  });
  it('routeTargets splits easy vs hard', () => {
    const r = routeTargets([
      { target: tgt('src/math.ts'), source: PURE },
      { target: tgt('src/api.ts'), source: NETWORK },
    ]);
    expect(r.easy.map((t) => t.sourcePath)).toEqual(['src/math.ts']);
    expect(r.hard.map((t) => t.sourcePath)).toEqual(['src/api.ts']);
  });
});

// ---- hermetic_gate scoping (dogfood fix) ------------------------------------
describe('hermetic_gate scopes to run-edited specs', () => {
  function ctxWith(files: Record<string, string>, edited: string[]): RunCtx {
    const dir = mkdtempSync(join(tmpdir(), 'pv-herm-'));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    const ctx = new RunCtx(dir, {} as any, 'task');
    edited.forEach((e) => ctx.editedFiles.add(e));
    return ctx;
  }
  const DIRTY = `it('x', async () => { await fetch('https://api.example.com/v1'); });`;
  const CLEAN = `import { it, expect } from 'vitest';\nit('x', () => expect(1).toBe(1));`;

  it('blocks when a spec THIS run edited has an external URL', async () => {
    const ctx = ctxWith({ 'src/a.test.ts': DIRTY }, ['src/a.test.ts']);
    const d = await hermeticGate.shouldStop!(ctx);
    expect(d.kind).toBe('block');
  });
  it('ignores a pre-existing dirty spec the run did NOT edit', async () => {
    // a.test.ts is dirty but untouched; only the clean b.test.ts was edited → ALLOW
    const ctx = ctxWith({ 'tests/a.test.ts': DIRTY, 'src/b.test.ts': CLEAN }, ['src/b.test.ts']);
    const d = await hermeticGate.shouldStop!(ctx);
    expect(d.kind).toBe('allow');
  });
});

// ---- audit_gate scoping (consistency with hermetic fix) ---------------------
describe('audit_gate scopes to run-edited specs', () => {
  function auditCtx(files: Record<string, string>, edited: string[]): RunCtx {
    const dir = mkdtempSync(join(tmpdir(), 'pv-audit-'));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    const adapter: any = {
      auditRules: () => jsAuditRules(),
      specFiles: async () => Object.keys(files),
    };
    const ctx = new RunCtx(dir, adapter, 'task');
    edited.forEach((e) => ctx.editedFiles.add(e));
    return ctx;
  }
  const DIRTY = `import { it, expect } from 'vitest';\nit.only('x', () => { expect(1).toBe(1); });`; // .only → audit error
  const CLEAN = `import { it, expect } from 'vitest';\nit('x', () => { expect(1).toBe(1); });`;

  it('blocks on an audit error in a spec THIS run edited', async () => {
    const ctx = auditCtx({ 'src/a.test.ts': DIRTY }, ['src/a.test.ts']);
    expect((await auditGate.shouldStop!(ctx)).kind).toBe('block');
  });
  it('ignores a pre-existing dirty spec not edited this run', async () => {
    const ctx = auditCtx({ 'src/old.test.ts': DIRTY, 'src/new.test.ts': CLEAN }, ['src/new.test.ts']);
    expect((await auditGate.shouldStop!(ctx)).kind).toBe('allow');
  });
});

// ---- Transcript caching -----------------------------------------------------
describe('transcript caching', () => {
  it('stableCacheIndex is undefined until a stable prefix exists', () => {
    expect(stableCacheIndex(1)).toBeUndefined();
    expect(stableCacheIndex(16)).toBeUndefined(); // 16 - 16 - 1 < 0
  });
  it('stableCacheIndex lands a positive index inside the pruned region for long transcripts', () => {
    const idx = stableCacheIndex(40)!; // 40 - 16 - 1 = 23
    expect(idx).toBe(23);
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(40 - 16); // before the live window
  });

  it('withCacheBreakpoint marks only the LAST content block', () => {
    const am = toApiMsg({ role: 'assistant', text: 'hi', toolCalls: [{ id: 't1', name: 'read_file', input: {} }] });
    const out = withCacheBreakpoint(am);
    const blocks = out.content as any[];
    expect(blocks[blocks.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0].cache_control).toBeUndefined();
  });
  it('withCacheBreakpoint promotes a string body to a cached block', () => {
    const out = withCacheBreakpoint({ role: 'user', content: 'plain' });
    expect(Array.isArray(out.content)).toBe(true);
    expect(out.content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('the body places exactly 2 cache breakpoints (system/tools prefix + transcript)', () => {
    // Reproduce the brain's mapping logic deterministically.
    const messages = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', text: `m${i}` })) as any[];
    const cpi = stableCacheIndex(messages.length);
    const mapped = messages.map((m, i) =>
      cpi !== undefined && i === cpi && i < messages.length - 1 ? withCacheBreakpoint(toApiMsg(m)) : toApiMsg(m),
    );
    const transcriptBreakpoints = mapped.filter(
      (m) => Array.isArray(m.content) && m.content.some((b: any) => b.cache_control),
    ).length;
    expect(transcriptBreakpoints).toBe(1); // + the system/tools breakpoint = 2 total, well under Anthropic's 4
  });
});

// ---- Exemplar-RAG -----------------------------------------------------------
describe('library.similar', () => {
  const trace = (task: string, spec: string, stack = 'react-vitest-playwright', ts = '2026-01-01'): Trace => ({
    ts, stack, task, specPath: 'a.test.ts', spec,
  });

  it('tokenize drops stopwords and short tokens', () => {
    const t = tokenize('Add unit tests for the cartTotal discount helper');
    expect(t.has('carttotal')).toBe(true);
    expect(t.has('discount')).toBe(true);
    expect(t.has('the')).toBe(false);
    expect(t.has('add')).toBe(false);
  });
  it('similarity is higher for overlapping token sets', () => {
    const a = tokenize('cartTotal discount coupon');
    const close = tokenize('cartTotal discount rounding');
    const far = tokenize('navbar router theme');
    expect(similarity(a, close)).toBeGreaterThan(similarity(a, far));
  });

  it('pickSimilarTrace returns the keyword-closest same-stack trace', () => {
    const traces = [
      trace('navbar router theme toggle', 'NAV_SPEC'),
      trace('cartTotal discount coupon math', 'CART_SPEC'),
    ];
    const hit = pickSimilarTrace(traces, 'test the cartTotal discount calculation', 'react-vitest-playwright');
    expect(hit?.spec).toBe('CART_SPEC');
  });
  it('pickSimilarTrace ignores other stacks and returns null on no overlap', () => {
    const traces = [trace('cartTotal discount', 'CART', 'python-pytest')];
    expect(pickSimilarTrace(traces, 'cartTotal discount', 'react-vitest-playwright')).toBeNull();
    expect(pickSimilarTrace([trace('alpha beta', 'X')], 'gamma delta', 'react-vitest-playwright')).toBeNull();
  });
});

// ---- Text-extract fallback (non-tool-calling local models) ------------------
describe('loop.extract', () => {
  it('pulls a test-like fenced block out of prose', () => {
    const text = "Here's the test:\n\n```ts\nimport { it, expect } from 'vitest';\nit('adds', () => expect(1+1).toBe(2));\n```\nDone.";
    const ex = extractTestBlock(text)!;
    expect(ex.code).toContain("it('adds'");
    expect(ex.code).toContain('expect');
  });
  it('returns null when no fenced block or not test-like', () => {
    expect(extractTestBlock('just some prose, no code')).toBeNull();
    expect(extractTestBlock('```ts\nconst x = 1;\n```')).toBeNull(); // no assert/expect/it
  });
  it('reads a path from the fence info string', () => {
    expect(extractTestBlock('```ts src/cart.test.ts\nexpect(1).toBe(1)\n```')!.path).toBe('src/cart.test.ts');
  });
  it('reads a path from a leading comment in the block', () => {
    expect(extractTestBlock('```ts\n// src/util.test.ts\nit("x",()=>expect(1).toBe(1))\n```')!.path).toBe('src/util.test.ts');
  });
  it('reads a path mentioned in the prose before the fence', () => {
    expect(extractTestBlock('File: `tests/calc_test.go`\n```go\nfunc TestX(t *testing.T){t.Errorf("x")}\n```')!.path).toBe('tests/calc_test.go');
  });
  it('handles a truncated (unclosed) fence — output-budget cutoff', () => {
    const ex = extractTestBlock('```ts\nimport { it, expect } from "vitest";\nit("x", () => expect(1).toBe(1));\n// cut off mid-file, no closing fence');
    expect(ex).not.toBeNull();
    expect(ex!.code).toContain('expect');
  });
  it('picks the largest test-like block when several appear', () => {
    const ex = extractTestBlock('```ts\nexpect(1).toBe(1)\n```\nand\n```ts\nit("big",()=>{expect(2).toBe(2); expect(3).toBe(3)})\n```')!;
    expect(ex.code).toContain('big');
  });
});

describe('conventionalSpecPath', () => {
  it('maps each stack to its convention', () => {
    expect(conventionalSpecPath('react-vitest-playwright', 'src/Cart.tsx')).toBe('src/Cart.test.tsx');
    expect(conventionalSpecPath('node-vitest', 'src/util.ts')).toBe('src/util.test.ts');
    expect(conventionalSpecPath('python-pytest', 'pkg/calc.py')).toBe('pkg/test_calc.py');
    expect(conventionalSpecPath('go-test', 'calc.go')).toBe('calc_test.go');
    expect(conventionalSpecPath('rust-cargo', 'src/lib.rs')).toBe('tests/lib.rs');
    expect(conventionalSpecPath('angular', 'src/counter.service.ts')).toBe('src/counter.service.spec.ts');
  });
});

// ---- claude-code brain (per-turn JSON decision) -----------------------------
describe('brain.claude-code parseDecision', () => {
  it('parses a raw JSON tool-call decision', () => {
    const d = parseDecision('{"text":"reading","tool_calls":[{"name":"read_file","input":{"path":"a.ts"}}]}');
    expect(d.text).toBe('reading');
    expect(d.toolCalls).toEqual([{ id: 'cc-0', name: 'read_file', input: { path: 'a.ts' } }]);
  });
  it('parses a fenced + prose-wrapped decision', () => {
    const d = parseDecision('Sure, next step:\n```json\n{"tool_calls":[{"name":"plan","input":{"text":"x"}}]}\n```');
    expect(d.toolCalls[0].name).toBe('plan');
  });
  it('treats {"tool_calls": []} as a stop (no calls)', () => {
    expect(parseDecision('{"tool_calls":[]}').toolCalls).toEqual([]);
  });
  it('falls back to text when no JSON present', () => {
    const d = parseDecision('I think the tests are complete.');
    expect(d.toolCalls).toEqual([]);
    expect(d.text).toContain('complete');
  });
  it('extractJson handles nested braces + strings with braces', () => {
    const o = extractJson('noise {"a":{"b":"}{"},"c":1} trailing');
    expect(o).toEqual({ a: { b: '}{' }, c: 1 });
  });
});

// ---- Bridge brain (subagent-in-host services each turn) ---------------------
describe('brain.bridge toResponse', () => {
  it('maps host tool_calls to ToolCalls with ids', () => {
    const r = toResponse({ text: 'reading', tool_calls: [{ name: 'read_file', input: { path: 'a.ts' } }] });
    expect(r.toolCalls).toEqual([{ id: 'bridge-0', name: 'read_file', input: { path: 'a.ts' } }]);
    expect(r.stopReason).toBe('tool_use');
  });
  it('empty tool_calls is a stop; costUsd threads through', () => {
    const r = toResponse({ tool_calls: [], costUsd: 0 });
    expect(r.toolCalls).toEqual([]);
    expect(r.stopReason).toBe('end_turn');
    expect(r.usage.costUsd).toBe(0);
  });
});

// ---- Ledger: honest cost (claude-code reports actual spend) ------------------
describe('ledger honest cost', () => {
  const rec = (over: Partial<RunRecord>): RunRecord => ({
    ts: 't', runId: 'r', label: 'delegate:x', model: 'claude-code:haiku',
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cost: 0, accepted: false, tookOver: false,
    stopReason: 'max_steps', steps: 1, ...over,
  });
  it('summarize totals the brain-reported cost (claude-code:* unpriced otherwise)', () => {
    // cost field is what recordRun computed: costUsd when present, else token-priced.
    const s = summarize([rec({ cost: 0.3363, costUsd: 0.3363 }), rec({ cost: 0.1769, costUsd: 0.1769 })]);
    expect(s.totalCost).toBeCloseTo(0.5132, 4);
    expect(s.byModel['claude-code:haiku'].cost).toBeCloseTo(0.5132, 4);
  });
});

// ---- Flywheel promotion -----------------------------------------------------
describe('library_promote helpers', () => {
  it('kindFor distinguishes e2e specs from unit tests', () => {
    expect(kindFor('e2e/checkout.spec.ts')).toBe('e2e');
    expect(kindFor('src/cart.spec.tsx')).toBe('e2e');
    expect(kindFor('src/cart.test.ts')).toBe('unit');
  });
  it('categoryFor buckets by path shape', () => {
    expect(categoryFor('src/useCart.test.ts')).toBe('hooks');
    expect(categoryFor('e2e/flow.spec.ts')).toBe('flow');
    expect(categoryFor('src/formatMoney.test.ts')).toBe('pure-helpers');
    expect(categoryFor('src/Cart.test.tsx')).toBe('component');
  });
  it('scoreFor rewards cleaner runs', () => {
    expect(scoreFor(0)).toBe(100);
    expect(scoreFor(3)).toBe(70);
    expect(scoreFor(20)).toBe(0); // clamped
  });
  it('slugFor is content-addressed: same spec → same slug, different spec → different', () => {
    const a = slugFor('src/Cart.test.tsx', 'CONTENT_A');
    const a2 = slugFor('src/Cart.test.tsx', 'CONTENT_A');
    const b = slugFor('src/Cart.test.tsx', 'CONTENT_B');
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
    expect(a.startsWith('cart-test-')).toBe(true);
  });
});
