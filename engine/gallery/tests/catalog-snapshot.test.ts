// Visual-regression gate — snapshots each widget's rendered CELL grid (plain
// text) + SVG string. Deterministic (no randomness/time), node-only, no browser.
// A rendering change (gauge shape, stepper layout, typography) shows up as a
// snapshot diff instead of needing an eyeball on a screenshot. Update on purpose
// with `vitest -u` and review the diff.
import { describe, it, expect } from 'vitest';
import { ENTRIES } from '../src/gallery';
import { CellPainter } from '@facet/render-term';
import { SvgPainter } from '@facet/render-dom';

const cells = (name: string): string => {
  const e = ENTRIES.find((x) => x.name === name)!;
  const p = new CellPainter(e.w + 1, Math.max(e.h, 1) + 1);
  e.draw(p);
  const s = p.flush();
  return Array.from({ length: s.h }, (_, y) => s.cells.slice(y * s.w, (y + 1) * s.w).map((c) => c.ch).join('').replace(/\s+$/, '')).join('\n');
};
const svg = (name: string): string => {
  const e = ENTRIES.find((x) => x.name === name)!;
  const p = new SvgPainter(e.w, Math.max(e.h, 1));
  e.draw(p);
  return p.toSvg();
};

describe('catalog snapshot: cells + svg per widget', () => {
  for (const e of ENTRIES) {
    it(`${e.name} cells`, () => expect(cells(e.name)).toMatchSnapshot());
    it(`${e.name} svg`, () => expect(svg(e.name)).toMatchSnapshot());
  }
});
