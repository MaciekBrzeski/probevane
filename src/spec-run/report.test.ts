import { describe, it, expect } from 'vitest';
import { buildDarkReport, formatDarkReport } from './report.js';
import type { RunSpec } from './runspec.js';
import type { RunRecord } from '../cost/ledger.js';

const child = (id: string, only: string): RunSpec => ({
  id, prompt: 'add tests', path: 'write_tests', dir: '/repo', kind: 'unit',
  acceptance: {}, only, decompose: { perFile: false },
});

const run = (label: string, accepted: boolean, stopReason: string, tookOver = false): RunRecord => ({
  ts: `2020-01-01T00:00:0${label.length}Z`, runId: label, label: `generate:${label}`, dir: '/repo',
  model: 'ollama', tokensIn: 1, tokensOut: 1, cacheRead: 0, cost: 0, accepted, tookOver, stopReason, steps: 1,
});

describe('buildDarkReport', () => {
  const specs = [child('p-001', 'src/a.ts'), child('p-002', 'src/b.ts'), child('p-003', 'src/c.ts')];
  const records = [run('a', true, 'accepted'), run('b', false, 'difficulty')]; // c has no record

  it('classifies each unit accepted / parked / pending by its newest ledger record', () => {
    const r = buildDarkReport(specs, records);
    expect(r.rows.map((x) => x.status)).toEqual(['accepted', 'parked', 'pending']);
    expect(r.rows[1].stopReason).toBe('difficulty');
    expect(r.accepted).toBe(1);
    expect(r.parked).toBe(1);
    expect(r.pending).toBe(1);
    expect(r.summary).toContain('3 unit(s)');
  });

  it('takes the NEWEST matching record (a retry that later accepts wins)', () => {
    const r = buildDarkReport([child('p-001', 'src/a.ts')], [run('a', false, 'error'), run('a', true, 'accepted')]);
    expect(r.rows[0].status).toBe('accepted');
  });
});

describe('formatDarkReport', () => {
  it('marks accepted ✓ and parked ⏸ with the reason', () => {
    const out = formatDarkReport(buildDarkReport([child('p-001', 'src/a.ts')], [run('a', false, 'stuck')]));
    expect(out).toContain('⏸ src/a.ts (stuck)');
  });
});
