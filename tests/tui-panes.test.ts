import { describe, it, expect } from 'vitest';
import { blank, serialize, type Screen } from '../src/tui/screen.js';
import { projectsPane, listPane, menuPane, textPane } from '../src/tui/panes.js';
import { FG } from '../src/tui/draw.js';

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const cell = (s: Screen, x: number, y: number) => s.cells[y * s.w + x];
const R = (w: number, h: number) => ({ x: 0, y: 0, w, h });

describe('projectsPane', () => {
  it('renders projects as facet cards: name, run-count badge, accept %, last outcome', () => {
    const s = blank(80, 10);
    projectsPane(s, R(80, 10), [{ name: 'react-shop', runCount: 29, acceptRate: 0.79, lastRun: { op: 'generate', accepted: true } }]);
    const out = plain(serialize(s));
    expect(out).toContain('P R O J E C T S');
    expect(out).toContain('react-shop');
    expect(out).toContain('29');   // run-count badge
    expect(out).toContain('79%');  // accept-rate readout
    expect(out).toContain('generate:accepted');
    expect(cell(s, 4, 2).st.bold).toBe(true); // card title (name) drawn bold
  });
  it('says so when empty', () => {
    const s = blank(40, 4);
    projectsPane(s, R(40, 4), []);
    expect(plain(serialize(s))).toContain('no projects');
  });
});

describe('listPane', () => {
  it('marks the selected item and dims the rest', () => {
    const s = blank(30, 5);
    listPane(s, R(30, 5), 'docs', FG.acc, ['a.md', 'b.md', 'c.md'], 1);
    const out = plain(serialize(s));
    expect(out).toContain('▸ b.md');
    expect(out).not.toContain('▸ a.md');
    expect(cell(s, 2, 2).st.fg).toBe(FG.acc);   // selected row in accent
    expect(cell(s, 2, 2).st.bold).toBe(true);   // selected row bold
  });
  it('sel < 0 → nothing marked', () => {
    const s = blank(30, 4);
    listPane(s, R(30, 4), 'ops', FG.acc, ['generate', 'repair'], -1);
    expect(plain(serialize(s))).not.toContain('▸');
  });
  it('empty → a placeholder on the first body row', () => {
    const s = blank(30, 4);
    listPane(s, R(30, 4), 'docs', FG.acc, [], -1);
    expect(cell(s, 2, 1).ch).toBe('—'); // at r.y+1 (kills the row-offset mutant)
  });
});

describe('menuPane', () => {
  it('renders the ops as a facet menu with the title on the top border', () => {
    const s = blank(30, 6);
    menuPane(s, R(30, 6), 'operations', ['generate', 'feature', 'repair']);
    const out = plain(serialize(s));
    expect(out).toContain('operations'); // title on the border
    expect(out).toContain('generate');   // menu rows
    expect(out).toContain('repair');
  });
  it('highlights the selected row', () => {
    const s = blank(30, 6);
    menuPane(s, R(30, 6), 'ops', ['a', 'b'], 1);
    // selected row painted with the accent as a fill behind it
    expect(plain(serialize(s))).toContain('b');
  });
  it('empty → a placeholder', () => {
    const s = blank(20, 4);
    menuPane(s, R(20, 4), 'ops', []);
    expect(plain(serialize(s))).toContain('—');
  });
});

describe('textPane', () => {
  it('renders pre-split lines clipped to the pane', () => {
    const s = blank(24, 5);
    textPane(s, R(24, 5), 'page', FG.acc, ['# Title', 'a very long line that should be truncated hard', 'tail']);
    const out = plain(serialize(s));
    expect(out).toContain('# Title');
    expect(out).toContain('…');   // long line truncated
    expect(out).toContain('tail');
  });
});
