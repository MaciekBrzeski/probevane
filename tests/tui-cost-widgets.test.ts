import { describe, it, expect } from 'vitest';
import { blank, serialize } from '../src/tui/screen.js';
import { costExtras } from '../src/tui/cost-widgets.js';
import type { Snapshot } from '../src/tui/views.js';

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const R = (w: number, h: number) => ({ x: 0, y: 0, w, h });
const snap: Snapshot = {
  health: {}, totals: { acceptRate: 0.75 },
  daily: [{ date: 'd1', cost: 1 }, { date: 'd2', cost: 4 }, { date: 'd3', cost: 2 }, { date: 'd4', cost: 5 }],
  jobs: [], runs: [], runes: [], alerts: [], hubs: [], projects: [], wikiPages: [], ops: [],
};

describe('costExtras', () => {
  it('draws the daily-cost bars + acceptance donut/legend in a tall pane', () => {
    const s = blank(50, 32);
    costExtras(s, R(50, 32), snap);
    const out = plain(serialize(s));
    expect(out).toContain('daily $');   // barChart caption
    expect(out).toContain('75%');       // donut acceptance label
    expect(out).toContain('accepted');  // legend
    expect(out).toContain('rejected');
  });
  it('no-ops in a short pane (nothing to clobber the tested cost rows)', () => {
    const s = blank(40, 6);
    costExtras(s, R(40, 6), snap);
    expect(plain(serialize(s)).trim()).toBe('');
  });
});
