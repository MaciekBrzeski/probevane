import { describe, it, expect } from 'vitest';
import { blank, serialize } from '../src/tui/screen.js';
import { consoleWidgets, macroPhase } from '../src/tui/console-widgets.js';
import type { Snapshot } from '../src/tui/views.js';

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const R = (w: number, h: number) => ({ x: 0, y: 0, w, h });
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  health: {}, totals: { acceptRate: 0.5, runs: 250, totalCost: 5 }, daily: [],
  jobs: [], runs: [{ runId: 'r1', label: 'generate:app', accepted: true }, { runId: 'r2', label: 'repair:app', stopReason: 'error' }],
  runes: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }], alerts: [], hubs: [],
  projects: [], wikiPages: [], ops: [], ...over,
});

describe('macroPhase', () => {
  it('no runes → phase 0', () => {
    expect(macroPhase([], {})).toBe(0);
  });
  it('all runes ok → last phase (2)', () => {
    expect(macroPhase([{ name: 'a' }, { name: 'b' }, { name: 'c' }], { a: 'ok', b: 'ok', c: 'ok' })).toBe(2);
  });
  it('partway → a middle phase', () => {
    const runes = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }, { name: 'f' }];
    expect(macroPhase(runes, { a: 'ok', b: 'active' })).toBe(1); // 2/6 → floor(2/6*3)=1
  });
});

describe('consoleWidgets', () => {
  it('draws the headline stats, run-phase stepper, and recent-runs timeline', () => {
    const s = blank(90, 16);
    consoleWidgets(s, R(90, 16), snap(), { a: 'ok', b: 'active' });
    const out = plain(serialize(s));
    expect(out).toContain('headline');     // stat column divider
    expect(out).toContain('acceptance');   // a stat label
    expect(out).toContain('50%');          // acceptance value
    expect(out).toContain('run phase');    // stepper divider
    expect(out).toContain('plan');         // stepper step
    expect(out).toContain('recent runs');  // timeline divider
    expect(out).toContain('generate:app'); // a run in the timeline
  });
  it('bails out when the pane is too short to hold the widgets', () => {
    const s = blank(90, 5);
    consoleWidgets(s, R(90, 5), snap(), {});
    expect(plain(serialize(s)).trim()).toBe(''); // nothing drawn
  });
});
