import { describe, it, expect } from 'vitest';
import type { Painter } from '@facet/core';
import { gauge, nodeGraph } from '@facet/core';
import { SvgPainter } from '../src/index';
import { CellPainter, type Screen } from '@facet/render-term';

const grid = (s: Screen): string => Array.from({ length: s.h }, (_, y) => s.cells.slice(y * s.w, y * s.w + s.w).map((c) => c.ch).join('')).join('\n');
const braille = (s: Screen): boolean => s.cells.some((c) => c.ch.codePointAt(0)! >= 0x2800 && c.ch.codePointAt(0)! <= 0x28ff);

describe('parity: gauge', () => {
  const draw = (p: Painter) => gauge(p, { cx: 8, cy: 8, r: 5, value: 0.5, accent: 0x2fe6a8, track: 0x1b2a44 });
  const svg = new SvgPainter(16, 16); draw(svg);
  const cell = new CellPainter(16, 16); const cs = (draw(cell), cell.flush());

  it('renders arcs + a centred % in both', () => {
    expect(svg.items.filter((i) => i.tag === 'path').length).toBe(2); // track + value
    expect(svg.items.find((i) => i.tag === 'text')?.text).toBe('50%');
    expect(braille(cs)).toBe(true);        // arcs as braille
    expect(grid(cs)).toContain('50%');
  });
});

describe('parity: nodeGraph', () => {
  const nodes = [
    { id: 'a', label: 'alpha', deps: ['b'], accent: 0x4fd6ff },
    { id: 'b', label: 'beta', deps: [], accent: 0xc792ea },
  ];
  const draw = (p: Painter) => nodeGraph(p, { rect: { x: 0, y: 0, w: 40, h: 8 }, nodes, edge: 0x1b2a44 });
  const svg = new SvgPainter(40, 8); draw(svg);
  const cell = new CellPainter(40, 8); const cs = (draw(cell), cell.flush());

  it('renders both nodes + an edge + labels in both', () => {
    expect(svg.items.filter((i) => i.tag === 'rect').length).toBe(2); // node boxes (canvas)
    expect(svg.items.filter((i) => i.tag === 'line').length).toBe(1); // edge b→a
    expect(svg.items.filter((i) => i.tag === 'text').map((i) => i.text)).toEqual(expect.arrayContaining(['alpha', 'beta']));
    const g = grid(cs);
    expect(g).toContain('( alpha )'); // 1-row pill on the glyph grid
    expect(g).toMatch(/[─│]|[⠀-⣿]/); // the edge, box-drawing or braille
  });
});
