// Parity oracle over the WHOLE catalog — every ENTRY drawn once against each
// backend must (a) actually render something in both and (b) agree on the text
// labels it draws. Catches a widget that silently no-ops in one backend or drifts
// its labels between SVG and cells. Node-only (no browser).
import { describe, it, expect } from 'vitest';
import { ENTRIES } from '../src/gallery';
import { CellPainter } from '@facet/render-term';
import { SvgPainter } from '@facet/render-dom';

const cellText = (name: string): string => {
  const e = ENTRIES.find((x) => x.name === name)!;
  const p = new CellPainter(e.w + 1, Math.max(e.h, 1) + 1);
  e.draw(p);
  const s = p.flush();
  return Array.from({ length: s.h }, (_, y) => s.cells.slice(y * s.w, (y + 1) * s.w).map((c) => c.ch).join('')).join('\n');
};
const cellDrew = (name: string): boolean => {
  const e = ENTRIES.find((x) => x.name === name)!;
  const p = new CellPainter(e.w + 1, Math.max(e.h, 1) + 1);
  e.draw(p);
  return p.flush().cells.some((c) => c.ch !== ' ' || c.st.fg !== undefined || c.st.bg !== undefined);
};
const svgOf = (name: string): string => {
  const e = ENTRIES.find((x) => x.name === name)!;
  const p = new SvgPainter(e.w, Math.max(e.h, 1));
  e.draw(p);
  return p.toSvg();
};
const compact = (s: string) => s.replace(/\s+/g, '');

describe('catalog parity: every widget renders in both backends with agreeing labels', () => {
  for (const e of ENTRIES) {
    it(`${e.name}`, () => {
      const svg = svgOf(e.name);
      expect(cellDrew(e.name), `${e.name} drew nothing in cells`).toBe(true);
      expect(svg, `${e.name} drew nothing in svg`).toMatch(/<(rect|line|path|text|circle|polyline|polygon)\b/);
      // every non-blank SVG text label's glyphs must appear in the cell render
      const labels = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]!).filter((s) => s.trim());
      const cells = compact(cellText(e.name));
      for (const lab of labels) expect(cells, `${e.name}: label "${lab}" missing from cells`).toContain(compact(lab));
    });
  }
});
