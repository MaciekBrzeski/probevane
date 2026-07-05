import { describe, it, expect } from 'vitest';
import { CellPainter, blank, putText, blit, serialize, type Screen } from '../src/index';

const grid = (s: Screen): string[] => Array.from({ length: s.h }, (_, y) => s.cells.slice(y * s.w, y * s.w + s.w).map((c) => c.ch).join(''));
const at = (s: Screen, x: number, y: number) => s.cells[y * s.w + x]!;

describe('CellPainter', () => {
  it('strokes a rect as rounded box-drawing; fills set a bg', () => {
    const p = new CellPainter(12, 5);
    p.rect(0, 0, 12, 5, { fill: 0x0b1220, stroke: 0x4fd6ff });
    const s = p.flush();
    expect(at(s, 0, 0).ch).toBe('╭');
    expect(at(s, 11, 0).ch).toBe('╮');
    expect(at(s, 0, 4).ch).toBe('╰');
    expect(at(s, 5, 2).st.bg).toBe(0x0b1220); // interior filled
    expect(at(s, 0, 0).st.fg).toBe(0x4fd6ff); // border in stroke colour
  });

  it('draws axis-aligned lines as box-drawing runs', () => {
    const p = new CellPainter(10, 5);
    p.line(1, 2, 8, 2, { stroke: 0x2fe6a8 }); // horizontal
    p.line(4, 0, 4, 4, { stroke: 0x2fe6a8 }); // vertical
    const s = p.flush();
    expect(grid(s)[2]).toContain('─');
    expect(at(s, 4, 0).ch).toBe('│');
  });

  it('rasterizes a diagonal line + an arc as braille', () => {
    const p = new CellPainter(12, 8);
    p.line(0, 0, 11, 7, { stroke: 0xffb454 });
    p.arc(6, 4, 3, 0, Math.PI, { stroke: 0xc792ea });
    const s = p.flush();
    const braille = s.cells.some((c) => c.ch.codePointAt(0)! >= 0x2800 && c.ch.codePointAt(0)! <= 0x28ff);
    expect(braille).toBe(true);
  });

  it('places + aligns text', () => {
    const p = new CellPainter(20, 3);
    p.text(10, 1, 'HELLO', { fill: 0xcfe3f5, align: 'c' });
    const row = grid(p.flush())[1]!;
    expect(row).toContain('HELLO');
    expect(row.indexOf('H')).toBe(10 - Math.floor(5 / 2)); // centred
  });

  it('blit overlays a sub-screen, leaving blank cells transparent', () => {
    const dst = blank(10, 3);
    putText(dst, 0, 0, '##########', { fg: 0x111111 });
    const src = blank(4, 1);
    putText(src, 1, 0, 'X', { fg: 0x4fd6ff }); // one glyph amid blanks
    blit(dst, src, 3, 0);
    expect(dst.cells[3 * 1 + 0]).toBeDefined();
    expect(dst.cells[4]!.ch).toBe('X');           // glyph copied at dx+1
    expect(dst.cells[4]!.st.fg).toBe(0x4fd6ff);
    expect(dst.cells[3]!.ch).toBe('#');           // blank src cell didn't clobber '#'
  });

  it('toAnsi diff-flushes: full frame first, then only changes', () => {
    const p = new CellPainter(6, 2);
    p.text(0, 0, 'ab', { fill: 0xffffff });
    const first = p.toAnsi(null);
    expect(first).toContain('\x1b[H'); // full serialize
    expect(first).toContain('a');
    const prev = p.flush();
    const q = new CellPainter(6, 2);
    q.text(0, 0, 'ab', { fill: 0xffffff });
    expect(q.toAnsi(prev)).toBe(''); // identical → nothing emitted
    expect(serialize(prev)).toContain('a');
  });
});
