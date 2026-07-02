import { describe, it, expect } from 'vitest';
import { spentSince, overCap } from '../src/cost/budget.js';
import { backoffMs, consecutiveErrors, quarantined } from '../src/observe/quarantine.js';
import { shouldHalt, type Alert } from '../src/observe/alerts.js';
import type { RunRecord } from '../src/cost/ledger.js';

const rec = (over: Partial<RunRecord>): RunRecord => ({
  ts: '2026-06-27T12:00:00.000Z',
  runId: 'r',
  label: 'generate:app',
  model: 'm',
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cost: 0.1,
  accepted: true,
  tookOver: false,
  stopReason: 'accepted',
  steps: 1,
  ...over,
});

const NOW = Date.parse('2026-06-27T12:00:00Z');

describe('budget', () => {
  it('spentSince sums only runs inside the window', () => {
    const recs = [rec({ ts: '2026-06-27T11:30:00Z', cost: 0.2 }), rec({ ts: '2026-06-26T00:00:00Z', cost: 9 })];
    expect(spentSince(recs, NOW - 3_600_000, NOW)).toBe(0.2); // last hour only
  });
  it('overCap fires at/over the cap, never with cap<=0', () => {
    const recs = [rec({ cost: 0.6 }), rec({ cost: 0.6 })];
    expect(overCap(recs, 1, 24, NOW)).toBe(true); // 1.2 >= 1
    expect(overCap(recs, 5, 24, NOW)).toBe(false);
    expect(overCap(recs, 0, 24, NOW)).toBe(false); // disabled
  });
});

describe('quarantine', () => {
  it('backoffMs is exponential and capped', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1, 1000, 99999)).toBe(1000);
    expect(backoffMs(3, 1000, 99999)).toBe(4000);
    expect(backoffMs(50, 1000, 5000)).toBe(5000); // cap
  });
  it('consecutiveErrors counts trailing errors per label, reset by a success', () => {
    const recs = [
      rec({ label: 'a', accepted: false, stopReason: 'error' }),
      rec({ label: 'a', accepted: true, stopReason: 'accepted' }), // resets a
      rec({ label: 'b', accepted: false, stopReason: 'error' }),
      rec({ label: 'b', accepted: false, stopReason: 'error' }),
    ];
    const s = consecutiveErrors(recs);
    expect(s['a']).toBe(0);
    expect(s['b']).toBe(2);
    expect(quarantined(s, 'b', 2)).toBe(true);
    expect(quarantined(s, 'a', 2)).toBe(false);
  });
});

describe('shouldHalt (circuit-breaker)', () => {
  const a = (severity: Alert['severity']): Alert => ({ kind: 'error_burst', severity, message: 'x', value: 1, threshold: 1 });
  it('halts on an error-severity alert, not on warn-only', () => {
    expect(shouldHalt([a('warn')])).toBe(false);
    expect(shouldHalt([a('warn'), a('error')])).toBe(true);
    expect(shouldHalt([])).toBe(false);
  });
});
