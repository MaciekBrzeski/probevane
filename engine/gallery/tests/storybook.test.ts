import { describe, it, expect } from 'vitest';
import { renderStorybook } from '../src/storybook';
import { ENTRIES } from '../src/gallery';

const rowText = (scr: { w: number; cells: { ch: string }[] }, y: number): string =>
  scr.cells.slice(y * scr.w, (y + 1) * scr.w).map((c) => c.ch).join('');
const text = (scr: { w: number; h: number; cells: { ch: string }[] }): string =>
  Array.from({ length: scr.h }, (_, y) => rowText(scr, y)).join('\n');

describe('storybook', () => {
  it('renders a frame sized to the terminal', () => {
    const scr = renderStorybook(90, 30, 0, 0);
    expect(scr.w).toBe(90);
    expect(scr.h).toBe(30);
  });

  it('shows every component name in the left rail (tall enough to hold them all)', () => {
    const scr = renderStorybook(90, ENTRIES.length + 6, 0, 0); // window ≥ entry count → no scroll
    const t = text(scr);
    for (const e of ENTRIES) expect(t, e.name).toContain(e.name);
  });

  it('windows the rail around the selection when the terminal is short', () => {
    const scr = renderStorybook(90, 16, ENTRIES.length - 1, 0); // last entry selected, short screen
    expect(text(scr)).toContain(ENTRIES[ENTRIES.length - 1]!.name); // selection stays visible
    expect(text(scr)).not.toContain(ENTRIES[0]!.name);              // top entries scrolled off
  });

  it('detail pane shows the selected component name, desc + usage', () => {
    const sel = ENTRIES.findIndex((e) => e.name === 'gauge');
    const scr = renderStorybook(90, 40, sel, 0);
    const t = text(scr);
    expect(t).toContain('gauge');
    expect(t).toContain('Ring gauge');
    expect(t).toContain('gauge(p,');
  });

  it('marks the selected row with ▸', () => {
    const scr = renderStorybook(90, 40, 2, 0);
    expect(text(scr)).toContain('▸ ' + ENTRIES[2]!.name);
  });

  it('the animated spinner advances between ticks', () => {
    const sel = ENTRIES.findIndex((e) => e.name === 'spinner');
    const a = text(renderStorybook(90, 40, sel, 0));
    const b = text(renderStorybook(90, 40, sel, 400));
    expect(a).not.toBe(b);
  });
});
