import { describe, it, expect } from 'vitest';
import { tracesPayload, metricsPayload, prometheusText, nanos } from '../src/observe/otel.js';
import type { RunRecord } from '../src/cost/ledger.js';

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  ts: '2026-06-27T10:00:00.000Z',
  runId: 'run-abc',
  label: 'generate:app',
  model: 'claude-haiku-4-5',
  tokensIn: 1000,
  tokensOut: 200,
  cacheRead: 50,
  cost: 0.1,
  accepted: true,
  tookOver: false,
  stopReason: 'accepted',
  steps: 5,
  ...over,
});

describe('nanos', () => {
  it('converts ISO → unix-nanos string', () => {
    expect(nanos('1970-01-01T00:00:01.000Z')).toBe('1000000000'); // 1s = 1e9 ns
  });
});

describe('tracesPayload', () => {
  it('emits one span per run with gen_ai.* + probevane.* attributes', () => {
    const p = tracesPayload([rec(), rec({ runId: 'run-2', accepted: false, stopReason: 'error' })]);
    const spans = p.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    const a = Object.fromEntries(spans[0].attributes.map((x: any) => [x.key, x.value]));
    expect(a['gen_ai.request.model']).toEqual({ stringValue: 'claude-haiku-4-5' });
    expect(a['gen_ai.usage.input_tokens']).toEqual({ intValue: '1000' });
    expect(a['probevane.accepted']).toEqual({ boolValue: true });
    expect(spans[0].status.code).toBe(1); // OK
    expect(spans[1].status.code).toBe(2); // ERROR (not accepted)
  });
  it('gives distinct, stable ids per run', () => {
    const a = tracesPayload([rec()]).resourceSpans[0].scopeSpans[0].spans[0];
    const b = tracesPayload([rec()]).resourceSpans[0].scopeSpans[0].spans[0];
    expect(a.traceId).toBe(b.traceId); // deterministic
    expect(a.traceId).toHaveLength(32);
    expect(a.spanId).toHaveLength(16);
    expect(a.traceId).not.toBe(a.spanId);
  });
});

describe('metricsPayload', () => {
  it('aggregates token usage, runs, acceptance, cost (by model)', () => {
    const p = metricsPayload([rec(), rec({ runId: 'r2', model: 'claude-sonnet-4-6', cost: 0.3, accepted: false, stopReason: 'error' })], '2026-06-27T11:00:00Z');
    const metrics = p.resourceMetrics[0].scopeMetrics[0].metrics;
    const byName = Object.fromEntries(metrics.map((m: any) => [m.name, m]));
    expect(byName['gen_ai.client.token.usage'].sum.dataPoints).toHaveLength(2); // input + output
    expect(byName['probevane.runs'].sum.dataPoints[0].asInt).toBe('2');
    expect(byName['probevane.acceptance_rate'].gauge.dataPoints[0].asDouble).toBe(0.5);
    // cost: global + per-model points
    expect(byName['probevane.cost_usd'].sum.dataPoints.length).toBe(3);
  });
});

describe('prometheusText', () => {
  it('renders scrape-friendly counters/gauges', () => {
    const t = prometheusText([rec(), rec({ runId: 'r2', accepted: false, stopReason: 'error' })]);
    expect(t).toContain('probevane_runs_total 2');
    expect(t).toContain('probevane_accepted_total 1');
    expect(t).toContain('probevane_acceptance_rate 0.5');
    expect(t).toContain('probevane_tokens_total{type="input"} 2000');
    expect(t).toContain('# TYPE probevane_cost_usd_total counter');
  });
});

describe('tracesPayload span width', () => {
  it('span width = durationMs when the run recorded one', () => {
    const s = tracesPayload([rec({ durationMs: 2500 })]).resourceSpans[0].scopeSpans[0].spans[0];
    expect(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)).toBe(2_500_000_000n);
  });
  it('zero-width span for ledger lines that predate durationMs', () => {
    const s = tracesPayload([rec()]).resourceSpans[0].scopeSpans[0].spans[0];
    expect(s.endTimeUnixNano).toBe(s.startTimeUnixNano);
  });
  it('negative duration clamps to zero-width (clock skew guard)', () => {
    const s = tracesPayload([rec({ durationMs: -50 })]).resourceSpans[0].scopeSpans[0].spans[0];
    expect(s.endTimeUnixNano).toBe(s.startTimeUnixNano);
  });
});
