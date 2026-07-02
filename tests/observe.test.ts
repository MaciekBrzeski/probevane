import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { aggregateOverTime, dayOf } from '../src/observe/aggregate.js';
import { computeAlerts } from '../src/observe/alerts.js';
import { recordAudit, readAudit } from '../src/observe/audit.js';
import type { RunRecord } from '../src/cost/ledger.js';

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  ts: '2026-06-20T10:00:00.000Z',
  runId: 'r',
  label: 'generate:app',
  model: 'claude-haiku-4-5',
  tokensIn: 1000,
  tokensOut: 200,
  cacheRead: 0,
  cost: 0.1,
  accepted: true,
  tookOver: false,
  stopReason: 'accepted',
  steps: 5,
  ...over,
});

describe('dayOf', () => {
  it('takes the UTC date prefix', () => {
    expect(dayOf('2026-06-26T21:22:16.696Z')).toBe('2026-06-26');
    expect(dayOf('')).toBe('');
  });
});

describe('aggregateOverTime', () => {
  it('buckets by day ascending and computes per-day rate/cost', () => {
    const records = [
      rec({ ts: '2026-06-20T10:00:00Z', cost: 0.1, accepted: true }),
      rec({ ts: '2026-06-20T12:00:00Z', cost: 0.2, accepted: false, stopReason: 'error' }),
      rec({ ts: '2026-06-21T09:00:00Z', cost: 0.05, accepted: true }),
    ];
    const ot = aggregateOverTime(records);
    expect(ot.daily.map((d) => d.date)).toEqual(['2026-06-20', '2026-06-21']);
    const d0 = ot.daily[0];
    expect(d0.runs).toBe(2);
    expect(d0.cost).toBe(0.3);
    expect(d0.accepted).toBe(1);
    expect(d0.acceptRate).toBe(0.5);
    expect(d0.errors).toBe(1);
    expect(ot.firstTs).toBe('2026-06-20T10:00:00Z');
    expect(ot.lastTs).toBe('2026-06-21T09:00:00Z');
    expect(ot.totals.runs).toBe(3);
  });

  it('empty input → empty series, null bounds', () => {
    const ot = aggregateOverTime([]);
    expect(ot.daily).toEqual([]);
    expect(ot.firstTs).toBeNull();
    expect(ot.totals.runs).toBe(0);
  });
});

describe('computeAlerts', () => {
  // 7 quiet days at $0.10 each, then a $1.00 spike day.
  const quiet = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-06-${String(10 + i).padStart(2, '0')}`,
    runs: 4,
    cost: 0.1,
    accepted: 4,
    acceptRate: 1,
    tokensIn: 0,
    tokensOut: 0,
    errors: 0,
  }));

  it('fires cost_spike when latest day >> trailing avg', () => {
    const daily = [...quiet, { ...quiet[0], date: '2026-06-17', cost: 1.0 }];
    const alerts = computeAlerts(daily);
    expect(alerts.find((a) => a.kind === 'cost_spike')).toBeTruthy();
  });

  it('no cost_spike when latest is in line with trailing', () => {
    const daily = [...quiet, { ...quiet[0], date: '2026-06-17', cost: 0.12 }];
    expect(computeAlerts(daily).find((a) => a.kind === 'cost_spike')).toBeUndefined();
  });

  it('fires acceptance_drop when latest rate falls below trailing', () => {
    const daily = [
      ...quiet,
      { date: '2026-06-17', runs: 10, cost: 0.1, accepted: 4, acceptRate: 0.4, tokensIn: 0, tokensOut: 0, errors: 0 },
    ];
    expect(computeAlerts(daily).find((a) => a.kind === 'acceptance_drop')).toBeTruthy();
  });

  it('fires error_burst on enough error stops in the latest day', () => {
    const daily = [
      ...quiet,
      { date: '2026-06-17', runs: 6, cost: 0.1, accepted: 3, acceptRate: 0.5, tokensIn: 0, tokensOut: 0, errors: 3 },
    ];
    expect(computeAlerts(daily).find((a) => a.kind === 'error_burst')).toBeTruthy();
  });

  it('empty series → no alerts', () => {
    expect(computeAlerts([])).toEqual([]);
  });

  it('respects overridden thresholds', () => {
    const daily = [...quiet, { ...quiet[0], date: '2026-06-17', cost: 0.5 }];
    // default spikeFactor 3 fires (0.5 > 0.3); raising to 10 suppresses it.
    expect(computeAlerts(daily, { spikeFactor: 10 }).find((a) => a.kind === 'cost_spike')).toBeUndefined();
  });
});

describe('audit trail', () => {
  it('stamps ts and round-trips entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-audit-'));
    const path = join(dir, 'audit.jsonl');
    await recordAudit({ action: 'library.save', target: 'foo', detail: { stack: 'react' } }, path);
    await recordAudit({ action: 'library.save', target: 'bar' }, path);
    const got = await readAudit(path);
    expect(got).toHaveLength(2);
    expect(got[0].action).toBe('library.save');
    expect(got[0].target).toBe('foo');
    expect(typeof got[0].ts).toBe('string');
    expect(got[1].target).toBe('bar');
  });
});
