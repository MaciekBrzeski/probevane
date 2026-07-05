import { describe, it, expect } from 'vitest';
import type { Painter } from '@facet/core';
import { SvgPainter } from '../src/index';
import { CellPainter, type Screen } from '@facet/render-term';

// The PARITY ORACLE: one scene, drawn ONCE against the abstract Painter, must
// produce the corresponding form in BOTH backends. Not pixel-identity — a rect
// is an SVG <rect> and rounded box-drawing; a diagonal is an SVG <line> and
// braille; text is <text> and cells — at agreeing positions.

function scene(p: Painter): void {
  p.rect(0, 0, 20, 8, { fill: 0x0b1220, stroke: 0x4fd6ff });
  p.line(1, 1, 18, 1, { stroke: 0x2fe6a8 }); // horizontal (axis)
  p.line(1, 1, 18, 6, { stroke: 0xffb454 }); // diagonal
  p.arc(10, 4, 3, 0, Math.PI, { stroke: 0xc792ea });
  p.text(10, 4, 'NODE', { fill: 0xcfe3f5, align: 'c' });
}

const grid = (s: Screen): string[] => Array.from({ length: s.h }, (_, y) => s.cells.slice(y * s.w, y * s.w + s.w).map((c) => c.ch).join(''));

describe('parity: one scene → both backends agree structurally', () => {
  const svg = new SvgPainter(20, 8); scene(svg);
  const cell = new CellPainter(20, 8); scene(cell);
  const s = cell.flush();
  const g = grid(s);

  it('the rect renders in both (SVG <rect> ⇔ rounded box corner)', () => {
    expect(svg.items.some((i) => i.tag === 'rect')).toBe(true);
    expect(s.cells[0]!.ch).toBe('╭');
  });

  it('the axis line renders in both (SVG <line> ⇔ ─ run)', () => {
    expect(svg.items.some((i) => i.tag === 'line')).toBe(true);
    expect(g[1]).toContain('─');
  });

  it('the diagonal + arc render in both (SVG <line>/<path> ⇔ braille)', () => {
    expect(svg.items.some((i) => i.tag === 'path')).toBe(true); // arc
    expect(svg.items.filter((i) => i.tag === 'line').length).toBeGreaterThanOrEqual(2); // incl the diagonal
    expect(s.cells.some((c) => c.ch.codePointAt(0)! >= 0x2800 && c.ch.codePointAt(0)! <= 0x28ff)).toBe(true);
  });

  it('the label renders at an agreeing centre (x=10) in both', () => {
    const t = svg.items.find((i) => i.tag === 'text');
    expect(t?.text).toBe('NODE');
    expect(t?.attrs.x).toBe(10);
    expect(t?.attrs['text-anchor']).toBe('middle');
    expect(g[4]).toContain('NODE');
    expect(g[4]!.indexOf('N')).toBe(8); // centred on x=10 → starts at 10-2
  });
});
