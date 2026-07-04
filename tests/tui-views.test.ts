import { describe, it, expect } from 'vitest';
import { blank, serialize, type Screen } from '../src/tui/screen.js';
import { statusStrip, tabBar, gaugePane, telemetryPane, constellationPane, costPane, pipelinePane, jobsPane, alertsPane, footer, runIndexAt, runRowStart, inputBar } from '../src/tui/views.js';
import { TABS, tabSlots } from '../src/tui/tabs.js';
import { FG } from '../src/tui/draw.js';
import type { PipelineState } from '../src/observe/pipeline.js';

// Headless: paint panes over fixture data, assert the serialized screen —
// proves the views without a tty.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const R = (w: number, h: number) => ({ x: 0, y: 0, w, h });
const cell = (s: Screen, x: number, y: number) => s.cells[y * s.w + x];
const rowText = (s: Screen, y: number) => s.cells.slice(y * s.w, y * s.w + s.w).map((c) => c.ch).join('');

describe('tui views', () => {
  it('statusStrip shows headline stats, right-aligned', () => {
    const s = blank(90, 1);
    statusStrip(s, { version: '0.1.0', uptimeSec: 125 }, { totalCost: 10.8, acceptRate: 0.71, runs: 264 });
    const out = plain(serialize(s));
    expect(out).toContain('v0.1.0');
    expect(out).toContain('$10.80');
    expect(out).toContain('71%');
    expect(out).toContain('264 runs');
    expect(out).toContain('up 2m'); // uptime shown (kills the !==→=== mutant)
    expect(out.trimEnd().length).toBe(89); // right-aligned with a 1-col margin
  });

  it('statusStrip shows — for uptime when unknown', () => {
    const s = blank(60, 1);
    statusStrip(s, { version: '0.1.0' }, {});
    expect(plain(serialize(s))).toContain('up —');
  });

  it('tabBar marks the active tab with » « and glows it (bold)', () => {
    const s = blank(100, 1); // wide enough for all parity tabs
    tabBar(s, TABS, 1, 0); // 'runs' active
    const out = plain(serialize(s));
    expect(out).toContain('CONSOLE');
    expect(out).toContain('» RUNS «');
    expect(out).not.toContain('» CONSOLE «'); // inactive → no markers
    const runsStart = tabSlots(TABS)[1].start;   // 'runs' is tab index 1
    expect(cell(s, runsStart, 0).ch).toBe('»');  // active marker at its slot
    expect(cell(s, runsStart, 0).st.bold).toBe(true); // active glows bold
    expect(cell(s, 3, 0).st.bold).toBeFalsy();   // inactive 'PROJECTS' not bold
  });

  it('gaugePane draws bold bracketed bars from the shared gauge specs', () => {
    const s = blank(40, 6);
    gaugePane(s, R(40, 6), { acceptRate: 0.5, runs: 250 }, { t: 0, reveal: 1 });
    const out = plain(serialize(s));
    expect(out).toContain('acceptance'); // label from theme.gauges()
    expect(out).toContain('runs / 500');
    expect(out).toContain('50%');
    expect(out).toContain('250');
    expect(out).toMatch(/⟦[█░]+⟧/); // a gauge bar rendered
    const bw = Math.max(4, 40 - 12 - 10);
    expect(cell(s, 2 + 12, 1).st.bold).toBe(true);          // gauge bar bold (LABEL_W=12)
    expect(cell(s, 2 + 12 + bw + 2, 1).st.bold).toBe(true); // raw value bold
  });

  it('telemetryPane adds cost + tokens sparklines under the gauges', () => {
    const s = blank(40, 9);
    telemetryPane(s, R(40, 9), { acceptRate: 0.5, runs: 100 }, [{ date: '2026-07-01', cost: 1, tokensOut: 200 }, { date: '2026-07-03', cost: 4, tokensOut: 800 }], { t: 0, reveal: 1 });
    const out = plain(serialize(s));
    expect(out).toContain('T E L E M E T R Y');
    expect(out).toContain('acceptance');
    expect(out).toContain('cost / day');
    expect(out).toContain('tokens/day'); // both sparklines, like the browser
    expect(out).toMatch(/[▁▂▃▄▅▆▇█]/); // spark glyph
    // spark sits past the label column (x = 2 + LABEL_W) on the row below the gauges, drawn bold
    expect('▁▂▃▄▅▆▇█'.includes(cell(s, 2 + 12, 6).ch)).toBe(true);
    expect(cell(s, 2 + 12, 6).st.bold).toBe(true);
  });

  const hubs2 = [
    { id: 'a/core.ts', label: 'core', title: '', deps: ['a/net.ts'], weight: 1, callsNetwork: false, state: 'active' as const },
    { id: 'a/net.ts', label: 'net', title: '', deps: [], weight: 0.4, callsNetwork: true, state: 'err' as const },
  ];
  it('constellationPane draws the facet node graph when the pane fits', () => {
    const s = blank(50, 8); // wide + tall enough → graph
    constellationPane(s, R(50, 8), hubs2, 100);
    const out = plain(serialize(s));
    expect(out).toContain('M O D U L E'); // frame title
    expect(out).toContain('( core )');    // node pill
    expect(out).toContain('( net )');
    expect(s.cells.some((c) => c.st.fg === FG.err)).toBe(true); // net calls network → red
    expect(out).toMatch(/─|[⠀-⣿]/);       // an edge trace (box run or braille curve)
  });
  it('constellationPane falls back to the hub list when the pane is small', () => {
    const s = blank(30, 6); // too narrow for the graph
    constellationPane(s, R(30, 6), hubs2);
    expect(plain(serialize(s))).toMatch(/⟦[█░]+⟧/); // weight bars (list mode)
  });
  it('constellationPane says graph unavailable with no hubs', () => {
    const s = blank(40, 6);
    constellationPane(s, R(40, 6), []);
    expect(plain(serialize(s))).toContain('graph unavailable');
  });

  it('costPane renders a sparkline + the latest day', () => {
    const s = blank(40, 6);
    costPane(s, R(40, 6), [{ date: '2026-07-01', cost: 1 }, { date: '2026-07-02', cost: 4 }, { date: '2026-07-03', cost: 2 }]);
    const out = plain(serialize(s));
    expect(out).toContain('C O S T'); // letter-spaced LCARS title
    expect(out).toMatch(/[▁▂▃▄▅▆▇█]/); // a block glyph is present
    expect(out).toContain('2026-07-03');
    expect(cell(s, 2, 3).st.bold).toBe(true); // sparkline drawn bold (ACC)
  });

  it('pipelinePane lights runes by state', () => {
    const s = blank(60, 6);
    const state: PipelineState = { plan_first: 'ok', validation_gate: 'err' };
    pipelinePane(s, R(60, 6), [{ name: 'plan_first' }, { name: 'validation_gate' }, { name: 'audit_gate' }], state);
    const out = plain(serialize(s));
    expect(out).toContain('R U N'); // letter-spaced LCARS title
    expect(out).toContain('plan_first');
    expect(out).toContain('●'); // ok lamp
    expect(out).toContain('✖'); // err lamp
    expect(out).toContain('○'); // idle lamp (audit_gate)
  });

  it('pipelinePane wraps to a new row when runes overflow the pane width', () => {
    const s = blank(20, 6); // narrow → perRow = 1, so each rune is on its own row
    pipelinePane(s, R(20, 6), [{ name: 'a' }, { name: 'b' }, { name: 'c' }], { c: 'ok' });
    expect(rowText(s, 1)).toContain('a'); // r.y + 1
    expect(rowText(s, 3)).toContain('c'); // r.y + 1 + 2 (kills the wrap-row +→- mutant)
  });

  it('pipelinePane pulses the active lamp accent, leaves other states their own colour', () => {
    const s = blank(60, 3);
    pipelinePane(s, R(60, 3), [{ name: 'a' }, { name: 'b' }], { a: 'active', b: 'ok' }, 0);
    // t=0 → glow == acc; only the active lamp is recoloured, the ok lamp stays FG.ok
    expect(cell(s, 2, 1).st.fg).toBe(FG.acc);  // 'a' active
    expect(cell(s, 18, 1).st.fg).toBe(FG.ok);  // 'b' ok (kills the state===active → !== mutant)
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

  it('jobsPane renders the shared RUN_COLUMNS (headers + when/model/cost/steps cells)', () => {
    const s = blank(90, 8);
    jobsPane(s, R(90, 8), [],
      [{ runId: 'r1', ts: '2026-07-03T10:55:31Z', label: 'repair:py-calc', model: 'replay', accepted: true, cost: 0, steps: 3 }]);
    const out = plain(serialize(s));
    for (const h of ['when', 'label', 'model', 'status', 'cost', 'steps']) expect(out).toContain(h);
    expect(out).toContain('2026-07-03 10:55:31'); // when cell (T→space, trimmed)
    expect(out).toContain('replay');              // model cell
    expect(out).toContain('$0');                  // cost cell
    expect(cell(s, 2, 2).st.bold).toBe(true);     // column header row (below the "no active runs" line) drawn bold
  });

  it('jobsPane says no active runs when idle', () => {
    const s = blank(40, 6);
    jobsPane(s, R(40, 6), [], []);
    expect(plain(serialize(s))).toContain('no active runs');
  });

  it('alertsPane marks error severity with 🛑 and warn with ⚠', () => {
    const s = blank(50, 5);
    alertsPane(s, R(50, 5), [{ kind: 'error_burst', severity: 'error', message: '11 errors' }, { kind: 'cost_spike', severity: 'warn', message: 'up' }]);
    const out = plain(serialize(s));
    expect(out).toContain('🛑');
    expect(out).toContain('⚠');
    // each alert on its own row, in order (kills the r.y+1+i → r.y+1-i mutant)
    expect(rowText(s, 1)).toContain('error_burst');
    expect(rowText(s, 2)).toContain('cost_spike');
    // error severity drawn bold
    const errX = [...rowText(s, 1)].indexOf('🛑');
    expect(cell(s, errX, 1).st.bold).toBe(true);
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

describe('runIndexAt (mouse hit-test) + inputBar', () => {
  it('maps a click y to a run index below the active + column headers', () => {
    const r = { x: 0, y: 4, w: 40, h: 12 };
    // no active jobs → list starts at 4 + 1 (box) + 1 (summary) + 1 (column header) = 7
    expect(runIndexAt(r, 0, 7)).toBe(0);
    expect(runIndexAt(r, 0, 9)).toBe(2);
    expect(runIndexAt(r, 0, 6)).toBe(-1); // the column-header row, above the list
    // 2 active jobs push the list down by 2
    expect(runIndexAt(r, 2, 9)).toBe(0);
    // the active-job header caps at 3 rows even with more active
    expect(runIndexAt(r, 5, 7 + 3)).toBe(0);
  });
  it('returns -1 for clicks on the box bottom border / outside', () => {
    const r = { x: 0, y: 4, w: 40, h: 12 };
    expect(runIndexAt(r, 0, 4 + 12 - 1)).toBe(-1); // bottom border row
    expect(runIndexAt(r, 0, 100)).toBe(-1);
  });
  it('runRowStart offsets past the box top + active + column headers', () => {
    const r = { x: 0, y: 4, w: 40, h: 12 };
    expect(runRowStart(r, 0)).toBe(7);  // y + box + summary + column header
    expect(runRowStart(r, 2)).toBe(9);  // + 2 active-job rows
    expect(runRowStart(r, 9)).toBe(10); // active-job rows capped at 3
  });
  it('inputBar renders the prompt (bold) + buffer + a caret', () => {
    const s = blank(40, 5);
    inputBar(s, 'launch> ', 'generate .');
    const out = plain(serialize(s));
    expect(out).toContain('launch>');
    expect(out).toContain('generate .');
    expect(out).toContain('▏');
    expect(cell(s, 1, 4).st.bold).toBe(true); // prompt drawn bold
  });
});
