import { describe, it, expect, beforeAll } from 'vitest';
import { blank, serialize, type Screen } from '../src/tui/screen.js';
import { lcarsFrame, spaced } from '../src/tui/frame.js';
import { FG } from '../src/tui/draw.js';

beforeAll(() => { process.env.COLORTERM = 'truecolor'; });
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const at = (s: Screen, x: number, y: number) => s.cells[y * s.w + x].ch;
const st = (s: Screen, x: number, y: number) => s.cells[y * s.w + x].st;

describe('spaced', () => {
  it('uppercases + letter-spaces', () => {
    expect(spaced('runs')).toBe('R U N S');
    expect(spaced('a')).toBe('A');
    expect(spaced('')).toBe('');
  });
});

describe('lcarsFrame', () => {
  it('paints rounded accent corners, an accent left-rail, an elbow, and a spaced title', () => {
    // Off-origin so an index-shift mutant on the rail bounds leaks a cell into
    // the margin rows (0..1) instead of hiding behind clip/overpaint at y=0.
    const s = blank(20, 8);
    const r = { x: 1, y: 2, h: 5, w: 18 };
    lcarsFrame(s, r, 'runs', FG.acc);
    expect(at(s, 1, 2)).toBe('╭');        // rounded top-left
    expect(at(s, 1, 6)).toBe('╰');        // rounded bottom-left (r.y + r.h - 1)
    expect(at(s, 2, 2)).toBe('▬');        // elbow nub
    // corners are recoloured to accent (box() drew them in --line first) — pin
    // the colour, not just the glyph, so a "don't recolour" mutant dies.
    expect(st(s, 1, 2).fg).toBe(FG.acc);
    expect(st(s, 1, 6).fg).toBe(FG.acc);
    // the rail fills EXACTLY interior rows r.y+1..r.y+h-2 (here 3,4,5) — assert
    // the exact row set so a shifted start/end bound (off-by-one) dies.
    const railRows = s.cells.map((c, i) => (c.ch === '▉' ? Math.floor(i / s.w) : -1)).filter((y) => y >= 0);
    expect(railRows).toEqual([3, 4, 5]);
    expect(railRows.every((y) => st(s, 1, y).fg === FG.acc && st(s, 1, y).bold)).toBe(true);
    expect(plain(serialize(s))).toContain('R U N S'); // letter-spaced title
  });

  it('renders the accent colour on the rail (truecolor SGR present)', () => {
    const s = blank(12, 4);
    lcarsFrame(s, { x: 0, y: 0, w: 12, h: 4 }, 'x', FG.warn);
    expect(serialize(s)).toContain('1;38;2;255;180;84'); // --warn 0xffb454 bold (bg params may follow)
  });

  it('fills the panel with the --panel background', () => {
    const s = blank(12, 4);
    lcarsFrame(s, { x: 0, y: 0, w: 12, h: 4 }, '', FG.acc);
    expect(s.cells[1 * 12 + 5].st.bg).toBe(FG.panel); // an interior cell sits on the panel bg
    expect(serialize(s)).toContain('48;2;11;18;32');   // --panel 0x0b1220
  });

  it('borders (non-rail cells) use the dim --line colour', () => {
    const s = blank(12, 4);
    lcarsFrame(s, { x: 0, y: 0, w: 12, h: 4 }, '', FG.acc);
    expect(at(s, 11, 1)).toBe('│');       // right border
    expect(serialize(s)).toContain('38;2;27;42;68'); // --line 0x1b2a44
  });

  it('draws nothing for a degenerate rect', () => {
    const s = blank(5, 3);
    lcarsFrame(s, { x: 0, y: 0, w: 1, h: 3 }, 't', FG.acc);
    expect(s.cells.every((c) => c.ch === ' ')).toBe(true);
  });
});
