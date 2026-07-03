import { describe, it, expect } from 'vitest';
import { blank, serialize } from '../src/tui/screen.js';
import { header, costPane, pipelinePane, jobsPane, alertsPane, footer } from '../src/tui/views.js';
import type { PipelineState } from '../src/observe/pipeline.js';

// Headless: paint panes over fixture data, assert the serialized screen —
// proves the views without a tty.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const R = (w: number, h: number) => ({ x: 0, y: 0, w, h });

describe('tui views', () => {
  it('header shows title + headline stats', () => {
    const s = blank(90, 1);
    header(s, { version: '0.1.0', uptimeSec: 125, ledgers: 7 }, { totalCost: 10.8, acceptRate: 0.71, runs: 264 });
    const out = plain(serialize(s));
    expect(out).toContain('COMMAND CENTER');
    expect(out).toContain('v0.1.0');
    expect(out).toContain('$10.80');
    expect(out).toContain('71%');
  });

  it('costPane renders a sparkline + the latest day', () => {
    const s = blank(40, 6);
    costPane(s, R(40, 6), [{ date: '2026-07-01', cost: 1 }, { date: '2026-07-02', cost: 4 }, { date: '2026-07-03', cost: 2 }]);
    const out = plain(serialize(s));
    expect(out).toContain('cost / day');
    expect(out).toMatch(/[▁▂▃▄▅▆▇█]/); // a block glyph is present
    expect(out).toContain('2026-07-03');
  });

  it('pipelinePane lights runes by state', () => {
    const s = blank(60, 6);
    const state: PipelineState = { plan_first: 'ok', validation_gate: 'err' };
    pipelinePane(s, R(60, 6), [{ name: 'plan_first' }, { name: 'validation_gate' }, { name: 'audit_gate' }], state);
    const out = plain(serialize(s));
    expect(out).toContain('run pipeline');
    expect(out).toContain('plan_first');
    expect(out).toContain('●'); // ok lamp
    expect(out).toContain('✖'); // err lamp
    expect(out).toContain('○'); // idle lamp (audit_gate)
  });

  it('pipelinePane shows unavailable with no runes', () => {
    const s = blank(30, 4);
    pipelinePane(s, R(30, 4), [], {});
    expect(plain(serialize(s))).toContain('pipeline unavailable');
  });

  it('jobsPane lists active jobs and recent runs', () => {
    const s = blank(60, 8);
    jobsPane(s, R(60, 8),
      [{ op: 'feature', dir: '/x/py-calc', status: 'running', startedAt: '' }],
      [{ runId: 'run-1', label: 'generate:app', accepted: true }, { runId: 'run-2', label: 'repair:app', stopReason: 'error' }]);
    const out = plain(serialize(s));
    expect(out).toContain('1 active');
    expect(out).toContain('py-calc');
    expect(out).toContain('accepted');
    expect(out).toContain('error');
  });

  it('jobsPane says no active runs when idle', () => {
    const s = blank(40, 6);
    jobsPane(s, R(40, 6), [], []);
    expect(plain(serialize(s))).toContain('no active runs');
  });

  it('alertsPane renders alerts and empty state', () => {
    const s = blank(50, 5);
    alertsPane(s, R(50, 5), [{ kind: 'error_burst', severity: 'error', message: '11 errors' }]);
    expect(plain(serialize(s))).toContain('error_burst');
    const e = blank(50, 5);
    alertsPane(e, R(50, 5), []);
    expect(plain(serialize(e))).toContain('none');
  });

  it('footer prints the key hints', () => {
    const s = blank(80, 3);
    footer(s, 'q quit · r refresh');
    expect(plain(serialize(s))).toContain('q quit');
  });
});
