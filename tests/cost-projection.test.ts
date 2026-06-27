import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateRequestTokens, estimateOutputTokens } from '../src/cost/estimate.js';
import { toResponse } from '../src/brain/bridge.js';
import { projectLedger, isFreeRun, PROJECTION_MODELS } from '../src/cost/project.js';
import { costOf } from '../src/cost/pricing.js';
import type { RunRecord } from '../src/cost/ledger.js';

// Phase-5: meter $0-brain tokens, reprice at API rates.

describe('estimate', () => {
  it('estimateTokens scales with length, empty is 0', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('x'.repeat(35))).toBe(10); // 35 / 3.5
  });

  it('request tokens cover system + messages + tool schemas + per-msg overhead', () => {
    const n = estimateRequestTokens({
      system: 'sys',
      messages: [{ role: 'user', text: 'hello' }],
      tools: [{ name: 'read', description: 'read a file', inputSchema: { type: 'object' } }],
    });
    expect(n).toBeGreaterThan(4); // at least the per-message overhead
  });

  it('output tokens cover text + tool-call inputs', () => {
    const withCall = estimateOutputTokens('done', [{ id: 'a', name: 'write', input: { path: 'x.ts' } }]);
    const textOnly = estimateOutputTokens('done', []);
    expect(withCall).toBeGreaterThan(textOnly);
  });
});

describe('bridge meters tokens', () => {
  it('estimates input+output when host reports none', () => {
    const r = toResponse({ text: 'reading file now' }, 1234);
    expect(r.usage.input).toBe(1234);
    expect(r.usage.output).toBeGreaterThan(0);
    expect(r.usage.costUsd).toBe(0); // still $0 billed
  });

  it('prefers host-reported exact counts over the estimate', () => {
    const r = toResponse({ text: 'hi', usage: { input: 999, output: 7 } }, 1234);
    expect(r.usage.input).toBe(999);
    expect(r.usage.output).toBe(7);
  });
});

describe('projectLedger', () => {
  const rec = (over: Partial<RunRecord>): RunRecord => ({
    ts: 't', runId: 'r', label: 'feature:x', model: 'bridge',
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cost: 0, accepted: true, tookOver: false,
    stopReason: 'accept', steps: 1, ...over,
  });

  it('identifies $0 runs (bridge/local) vs billed', () => {
    expect(isFreeRun({ model: 'bridge' })).toBe(true);
    expect(isFreeRun({ model: 'local:qwen' })).toBe(true);
    expect(isFreeRun({ model: 'claude-haiku-4-5' })).toBe(false);
  });

  it('sums only $0-run tokens and reprices at each model', () => {
    const p = projectLedger([
      rec({ model: 'bridge', tokensIn: 100_000, tokensOut: 10_000 }),
      rec({ model: 'local:qwen', tokensIn: 50_000, tokensOut: 5_000 }),
      rec({ model: 'claude-opus-4-8', tokensIn: 999, tokensOut: 999 }), // billed → excluded
    ]);
    expect(p.freeRuns).toBe(2);
    expect(p.tokensIn).toBe(150_000);
    expect(p.tokensOut).toBe(15_000);
    expect(p.byModel['claude-haiku-4-5']).toBe(
      costOf('claude-haiku-4-5', { input: 150_000, output: 15_000 }),
    );
    // opus costs more than haiku for the same volume
    expect(p.byModel['claude-opus-4-8']).toBeGreaterThan(p.byModel['claude-haiku-4-5']!);
  });

  it('covers all projection models', () => {
    const p = projectLedger([rec({ tokensIn: 1000, tokensOut: 100 })]);
    for (const m of PROJECTION_MODELS) expect(p.byModel[m]).toBeGreaterThan(0);
  });
});
