import { describe, it, expect } from 'vitest';
import { blank, serialize } from '../src/tui/screen.js';
import { layoutFor, paintConsole, paintRuns, paintCost, paintProjects, paintDocs, paintLaunch, paintTerminal } from '../src/tui/screens.js';
import type { Snapshot } from '../src/tui/views.js';
import type { PipelineState } from '../src/observe/pipeline.js';

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const A = { t: 0, reveal: 1 };
const snap: Snapshot = {
  health: { version: '0.1.0', uptimeSec: 60 },
  totals: { totalCost: 5, acceptRate: 0.5, runs: 250 },
  daily: [{ date: '2026-07-01', cost: 1 }, { date: '2026-07-03', cost: 4 }],
  jobs: [{ op: 'feature', dir: '/x/py-calc', status: 'running', startedAt: '' }],
  runs: [{ runId: 'run-1', label: 'generate:app', accepted: true }, { runId: 'run-2', label: 'repair:app', stopReason: 'error' }],
  runes: [{ name: 'plan_first' }, { name: 'validation_gate' }],
  alerts: [{ kind: 'cost_spike', severity: 'warn', message: 'up' }],
  hubs: [{ id: 'a/engine.ts', label: 'engine', title: '', deps: [], weight: 1, callsNetwork: false, state: 'active' }],
  projects: [{ name: 'react-shop', runCount: 29, acceptRate: 0.79, lastRun: { op: 'generate', accepted: true } }],
  wikiPages: ['Home.md', 'Control-Center.md'],
  ops: ['generate', 'feature', 'repair'],
};

describe('layouts (one manifest-driven pass for every tab)', () => {
  it('reserve row 0 (tabs) and the last row (footer); body rects stay in bounds', () => {
    const [w, h] = [80, 24];
    const rects = ['console', 'runs', 'cost'].flatMap((tab) => Object.values(layoutFor(tab, w, h)));
    for (const r of rects) {
      expect(r.y).toBeGreaterThanOrEqual(1);        // below the tab bar
      expect(r.y + r.h).toBeLessThanOrEqual(h - 1); // above the footer
      expect(r.x + r.w).toBeLessThanOrEqual(w);
    }
  });

  it('console is a full-width pipeline hero over telemetry + constellation (from the manifest)', () => {
    const L = layoutFor('console', 80, 24);
    expect(L.pipeline.x).toBe(0);
    expect(L.pipeline.w).toBe(80);                              // hero spans full width
    expect(L.telemetry.y).toBe(L.pipeline.y + L.pipeline.h);    // bottom row, under the hero
    expect(L.constellation.x).toBe(L.telemetry.x + L.telemetry.w); // side by side, splitting the bottom
    expect(L.telemetry.y).toBe(L.constellation.y);
  });

  it('runs + cost tabs use the same engine (panes adjacent, no gaps/overlap)', () => {
    const runs = layoutFor('runs', 80, 24);
    expect(runs.jobs.x + runs.jobs.w).toBe(runs.alerts.x); // list meets alerts, no gap
    const cost = layoutFor('cost', 80, 24);
    expect(cost.alerts.x).toBe(cost.cost.x + cost.cost.w);       // right column starts where cost ends
    expect(cost.telemetry.y).toBe(cost.alerts.y + cost.alerts.h); // telemetry under alerts
    expect(cost.telemetry.x).toBe(cost.alerts.x);
  });

  it('an unknown tab → no panes', () => {
    expect(layoutFor('nope', 80, 24)).toEqual({});
  });
});

describe('paint composers', () => {
  it('paintConsole draws the pipeline hero, telemetry, and constellation (1:1 with browser)', () => {
    const s = blank(80, 24);
    paintConsole(s, 80, 24, snap, { plan_first: 'active' } as PipelineState, A);
    const out = plain(serialize(s));
    expect(out).toContain('R U N   P I P E L I N E');
    expect(out).toContain('plan_first');
    expect(out).toContain('T E L E M E T R Y');
    expect(out).toContain('250'); // run-volume gauge value
    expect(out).toContain('M O D U L E'); // constellation frame
    expect(out).toContain('engine');      // hub from snap.hubs
  });

  it('paintRuns lists runs with the selected row marked ▸ + alerts', () => {
    const s = blank(80, 24);
    paintRuns(s, 80, 24, snap, 1); // select the 2nd run
    const out = plain(serialize(s));
    expect(out).toContain('py-calc');       // active job
    expect(out).toContain('accepted');
    expect(out).toContain('▸ repair:app');  // selection marker on run-2
    expect(out).toContain('cost_spike');    // alerts pane present
  });

  it('paintCost draws cost, alerts, and gauges', () => {
    const s = blank(80, 24);
    paintCost(s, 80, 24, snap, A);
    const out = plain(serialize(s));
    expect(out).toContain('C O S T');
    expect(out).toContain('T E L E M E T R Y');
    expect(out).toContain('2026-07-03');
  });

  it('the parity tabs each render (projects, docs, launch, terminal)', () => {
    const P = blank(90, 10); paintProjects(P, 90, 10, snap);
    expect(plain(serialize(P))).toContain('react-shop');
    const D = blank(90, 10); paintDocs(D, 90, 10, snap, { docsSel: 1, docsBody: '# Hello\nbody', quality: '' });
    const dOut = plain(serialize(D));
    expect(dOut).toContain('▸ Control-Center.md'); // selected page marked
    expect(dOut).toContain('# Hello');             // page body rendered
    const L = blank(90, 10); paintLaunch(L, 90, 10, snap);
    const lOut = plain(serialize(L));
    expect(lOut).toContain('generate');            // op list
    expect(lOut).toContain('to launch');           // hint
    const T = blank(90, 10); paintTerminal(T, 90, 10);
    expect(plain(serialize(T))).toContain('drop to your shell');
  });
});
