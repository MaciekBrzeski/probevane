import { describe, it, expect } from 'vitest';
import { blank, serialize, type Screen } from '../src/tui/screen.js';
import { fitColumns, renderColumns } from '../src/tui/table.js';
import { RUN_COLUMNS } from '../src/util/theme.js';

const ids = (cols: { col: { id: string } }[]) => cols.map((c) => c.col.id);
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

describe('fitColumns', () => {
  it('keeps every column when there is room; the grow column takes the slack', () => {
    const fit = fitColumns(RUN_COLUMNS, 100);
    expect(ids(fit)).toEqual(['when', 'label', 'model', 'status', 'cost', 'steps']);
    const label = fit.find((c) => c.col.id === 'label')!;
    expect(label.w).toBeGreaterThan(label.col.w); // grew past its min
  });

  it('sheds low-priority columns when narrow, always keeping label + status', () => {
    const narrow = fitColumns(RUN_COLUMNS, 22);
    expect(ids(narrow)).toContain('label');
    expect(ids(narrow)).toContain('status');
    expect(ids(narrow)).not.toContain('steps'); // shed first
    expect(ids(narrow).length).toBeLessThan(RUN_COLUMNS.length);
  });

  it('sheds in RUN_COLUMN_DROP order (steps before cost before model before when)', () => {
    // width that fits all but one → only steps drops
    const one = fitColumns(RUN_COLUMNS, 56);
    expect(ids(one)).not.toContain('steps');
    expect(ids(one)).toContain('cost');
  });
});

describe('renderColumns', () => {
  it('paints cells left-to-right, right-aligning where asked', () => {
    const s: Screen = blank(30, 1);
    const layout = [
      { col: { id: 'a', header: 'a', w: 5, get: () => '' }, w: 5 },
      { col: { id: 'b', header: 'b', w: 6, align: 'r' as const, get: () => '' }, w: 6 },
    ];
    renderColumns(s, 0, 0, layout, [{ text: 'x', st: {} }, { text: '9', st: {} }]);
    const row = plain(serialize(s));
    expect(row.startsWith('x    ')).toBe(true); // left-aligned in width 5
    expect(row.slice(6, 12)).toBe('     9');     // right-aligned in width 6 (after 1-col gap)
  });
});
