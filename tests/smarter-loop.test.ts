import { describe, it, expect } from 'vitest';
import { isCircular, proposal, CIRCULAR_THRESHOLD } from '../src/loop/difficulty.js';
import { stableCacheIndex } from '../src/loop/engine.js';
import { toApiMsg, withCacheBreakpoint } from '../src/brain/anthropic-sdk.js';
import { tokenize, similarity, pickSimilarTrace } from '../src/library/similar.js';
import { kindFor, categoryFor, scoreFor, slugFor } from '../src/loop/runes/library_promote.js';
import { RunCtx } from '../src/loop/ctx.js';
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
