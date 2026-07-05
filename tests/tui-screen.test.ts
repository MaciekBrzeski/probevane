import { describe, it, expect, beforeAll } from 'vitest';
import { blank, putText, box, fillRect, serialize, diff, type Screen } from '../src/tui/screen.js';
import { FG } from '../src/tui/draw.js';

// Force truecolor so SGR assertions are deterministic (sgr() reads COLORTERM
// per call; CI/host env must not decide the emitted codes).
beforeAll(() => { process.env.COLORTERM = 'truecolor'; });

// Strip ANSI to assert rendered glyphs; keep the raw string for escape checks.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

describe('screen buffer', () => {
  it('blank fills a w*h grid of spaces', () => {
    const s = blank(4, 3);
    expect(s.cells).toHaveLength(12);
    expect(s.cells.every((c) => c.ch === ' ')).toBe(true);
  });

  it('putText writes clipped to the grid', () => {
    const s = blank(5, 2);
    putText(s, 1, 0, 'hello', { fg: FG.acc });
    expect(plain(serialize(s))).toContain('hell'); // clipped at width 5 (x=1 → 4 chars fit)
    putText(s, 0, 9, 'off', {}); // off-screen y → ignored, no throw
    expect(s.cells[0].ch).toBe(' ');
  });

  it('box draws rounded corners + side borders + a title', () => {
    const s = blank(10, 4);
    box(s, 0, 0, 10, 4, 'JOBS');
    const at = (x: number, y: number) => s.cells[y * s.w + x].ch;
    expect(at(0, 0)).toBe('╭');
    expect(at(9, 0)).toBe('╮');
    expect(at(0, 3)).toBe('╰');
    expect(at(9, 3)).toBe('╯');
    // side borders on every interior row (kills the "│" side-draw mutants)
    expect(at(0, 1)).toBe('│');
    expect(at(9, 1)).toBe('│');
    expect(at(0, 2)).toBe('│');
    expect(at(9, 2)).toBe('│');
    expect(plain(serialize(s))).toContain('JOBS');
  });

  it('fillRect sets a bg on the rect; putText over it keeps that bg', () => {
    const s = blank(6, 2);
    fillRect(s, 1, 0, 3, 1, 0x0b1220);
    expect(s.cells[1].st.bg).toBe(0x0b1220);      // inside the rect
    expect(s.cells[0].st.bg).toBeUndefined();     // outside untouched
    putText(s, 1, 0, 'X', { fg: FG.acc });        // no bg in style
    expect(s.cells[1].st).toMatchObject({ fg: FG.acc, bg: 0x0b1220 }); // glyph inherits panel bg
  });

  it('box smaller than 2×2 draws nothing', () => {
    const s = blank(5, 3);
    box(s, 0, 0, 1, 3, 'x');
    expect(s.cells.every((c) => c.ch === ' ')).toBe(true);
  });

  it('serialize emits truecolor SGR for styled cells', () => {
    const s = blank(3, 1);
    putText(s, 0, 0, 'X', { fg: FG.err, bold: true });
    const raw = serialize(s);
    expect(raw).toContain('\x1b[1;38;2;255;93;108m'); // bold + --err 0xff5d6c
    expect(raw).toContain('X');
  });

  it('sgr falls back to 256-color when the terminal lacks truecolor', () => {
    process.env.COLORTERM = '';
    const s = blank(2, 1);
    putText(s, 0, 0, 'Y', { fg: FG.acc });
    expect(serialize(s)).toContain('\x1b[38;5;'); // 256-color cube, not 38;2;
    process.env.COLORTERM = 'truecolor';
  });
});

describe('diff', () => {
  it('emits nothing when frames are identical', () => {
    const a = blank(5, 2);
    const b = blank(5, 2);
    expect(diff(a, b)).toBe('');
  });

  it('addresses + writes only the changed cell', () => {
    const a = blank(5, 2);
    const b = blank(5, 2);
    putText(b, 2, 1, 'Z', { fg: FG.ok });
    const out = diff(a, b);
    expect(out).toContain('Z');
    expect(out).toContain('\x1b[2;3H'); // row 2, col 3 (1-indexed)
    expect(plain(out)).toBe('Z'); // exactly one glyph changed
  });

  it('a style-only change (same glyph) still re-emits the cell', () => {
    const a = blank(3, 1);
    putText(a, 0, 0, 'x', { fg: FG.dim });
    const b = blank(3, 1);
    putText(b, 0, 0, 'x', { fg: FG.err, bold: true }); // same char, different style
    const out = diff(a, b);
    expect(out).toContain('\x1b[1;38;2;255;93;108m');
    expect(plain(out)).toContain('x');
  });

  it('falls back to a full paint on a size change', () => {
    const a = blank(3, 1);
    const b = blank(4, 1);
    putText(b, 0, 0, 'ab', {});
    expect(diff(a, b)).toContain('\x1b[H'); // serialize() home
  });

  it('null prev → full serialize', () => {
    const b = blank(2, 1);
    putText(b, 0, 0, 'q', {});
    expect(diff(null as unknown as Screen, b)).toContain('q');
  });
});
