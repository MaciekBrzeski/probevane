import { describe, it, expect } from 'vitest';
import { TABS, tabSlots, tabLabel, tabAtX } from '../src/tui/tabs.js';

describe('tabs', () => {
  it('exposes every browser tab (full parity)', () => {
    expect(TABS).toEqual(['projects', 'runs', 'docs', 'launch', 'cost', 'quality', 'console', 'terminal']);
  });

  it('active + inactive labels are the same width (slots never shift)', () => {
    for (const name of TABS) {
      expect([...tabLabel(name, true)]).toHaveLength(name.length + 4);
      expect([...tabLabel(name, false)]).toHaveLength(name.length + 4);
    }
    expect(tabLabel('runs', true)).toBe('» RUNS «');
    expect(tabLabel('runs', false)).toBe('  RUNS  ');
  });

  it('slots run left-to-right with a one-col gap, first at x=1, width = name+4', () => {
    const s = tabSlots(TABS);
    expect(s[0].start).toBe(1);
    s.forEach((slot, i) => {
      expect(slot.end - slot.start).toBe(TABS[i].length + 4); // label width
      if (i > 0) expect(slot.start).toBe(s[i - 1].end + 1);   // one-col gap after the previous
    });
  });

  it('hit-tests a column to the tab under it (or -1 in a gap / before the first)', () => {
    const s = tabSlots(TABS);
    expect(tabAtX(TABS, 0)).toBe(-1);              // left of the first tab
    expect(tabAtX(TABS, s[0].start)).toBe(0);
    expect(tabAtX(TABS, s[0].end)).toBe(-1);       // the gap after tab 0
    expect(tabAtX(TABS, s[2].start + 1)).toBe(2);
    expect(tabAtX(TABS, s[s.length - 1].end + 5)).toBe(-1); // past the last tab
  });
});
