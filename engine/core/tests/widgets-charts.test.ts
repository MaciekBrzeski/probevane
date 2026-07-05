import { describe, it, expect } from 'vitest';
import type { Painter, Caps, Pt, Style } from '../src/index';
import {
  barChart, donut, heatmap, legend, meter, buttonGroup, rating,
  skeleton, emptyState, scrollbar,
} from '../src/index';

type Call = [string, ...unknown[]];
class Rec implements Painter {
  calls: Call[] = [];
  readonly caps: Caps = { subpixel: true, curves: true, glyphGrid: false, cellW: 1, cellH: 1 };
  rect(x: number, y: number, w: number, h: number, st: Style) { this.calls.push(['rect', x, y, w, h, st]); }
  line() {} polyline() {} polygon() {}
  arc(cx: number, cy: number, r: number, a0: number, a1: number, st: Style) { this.calls.push(['arc', cx, cy, r, a0, a1, st]); }
  text(x: number, y: number, s: string, st: Style) { this.calls.push(['text', x, y, s, st]); }
  push() {} pop() {}
  of(tag: string) { return this.calls.filter((c) => c[0] === tag); }
  texts() { return this.of('text').map((c) => c[3] as string); }
}

describe('charts', () => {
  it('barChart: one accent bar per value, tallest at the series max', () => {
    const p = new Rec(); barChart(p, { rect: { x: 0, y: 0, w: 12, h: 10 }, values: [1, 2, 4], accent: 1, track: 2 });
    const accent = p.of('rect').filter((c) => (c[5] as Style).fill === 1);
    expect(accent).toHaveLength(3);
    const heights = accent.map((c) => c[4] as number);
    expect(Math.max(...heights)).toBe(10);           // the max value → full height
    expect(heights[0]).toBeLessThan(heights[2]!);     // 1 shorter than 4
  });
  it('barChart: skips a zero-height bar (value 0)', () => {
    const p = new Rec(); barChart(p, { rect: { x: 0, y: 0, w: 10, h: 8 }, values: [0, 4], accent: 1 });
    expect(p.of('rect').filter((c) => (c[5] as Style).fill === 1)).toHaveLength(1);
  });

  it('donut: an arc per non-zero segment + a track ring + centre label', () => {
    const p = new Rec(); donut(p, { cx: 8, cy: 8, r: 6, track: 9, label: '3', segments: [{ value: 3, color: 1 }, { value: 1, color: 2 }, { value: 0, color: 3 }] });
    expect(p.of('arc')).toHaveLength(3); // track + 2 non-zero segments (the 0 is skipped)
    // first segment spans 3/4 of the circle
    const seg = p.of('arc')[1]!;
    expect((seg[5] as number) - (seg[4] as number)).toBeCloseTo(2 * Math.PI * 0.75, 5);
    expect(p.texts()).toContain('3');
  });

  it('heatmap: one rect per cell, intensity between base and colour', () => {
    const p = new Rec(); heatmap(p, { x: 0, y: 0, cols: 2, rows: 2, values: [0, 1, 0.5, 0], base: 0x000000, color: 0xffffff });
    expect(p.of('rect')).toHaveLength(4);
    expect((p.of('rect')[0]![5] as Style).fill).toBe(0x000000); // v=0 → base
    expect((p.of('rect')[1]![5] as Style).fill).toBe(0xffffff); // v=1 → colour
  });

  it('legend: a swatch rect + label per item', () => {
    const p = new Rec(); legend(p, { x: 0, y: 0, items: [{ label: 'ok', color: 1 }, { label: 'err', color: 2 }] });
    expect(p.of('rect')).toHaveLength(2);
    expect(p.texts()).toEqual(['ok', 'err']);
    // vertical by default → second row below the first
    expect(p.of('text')[1]![2]).toBe(1);
  });

  it('meter: stacked segments sized to their share of the total', () => {
    const p = new Rec(); meter(p, { rect: { x: 0, y: 0, w: 20, h: 1 }, track: 9, segments: [{ value: 3, color: 1 }, { value: 1, color: 2 }] });
    const segs = p.of('rect').filter((c) => (c[5] as Style).fill !== 9);
    expect(segs).toHaveLength(2);
    expect(segs[0]![3]).toBe(15); // 3/4 * 20
    expect(segs[1]![3]).toBe(5);  // 1/4 * 20
  });
});

describe('controls (group + rating)', () => {
  it('buttonGroup: active option filled + bold, others dim', () => {
    const p = new Rec(); buttonGroup(p, { x: 0, y: 0, options: ['day', 'week'], active: 1, accent: 1, fg: 2, dim: 3 });
    expect(p.of('rect')).toHaveLength(1); // only the active fill
    expect(p.texts()).toEqual(['day', 'week']);
    const week = p.of('text').find((c) => c[3] === 'week')!;
    expect(week[4]).toMatchObject({ fill: 2, bold: true });
  });
  it('rating: full stars to value, hollow for the rest', () => {
    const p = new Rec(); rating(p, { x: 0, y: 0, value: 3, max: 5, accent: 1, dim: 2 });
    expect(p.texts()[0]).toBe('★★★');
    expect(p.texts()[1]).toBe('☆☆');
  });
});

describe('state', () => {
  it('skeleton: one bar per line, staggered widths', () => {
    const p = new Rec(); skeleton(p, { rect: { x: 0, y: 0, w: 20, h: 3 }, color: 1, lines: 3 });
    expect(p.of('rect')).toHaveLength(3);
    expect(p.of('rect')[0]![3]).not.toBe(p.of('rect')[1]![3]); // alternating width
  });
  it('emptyState: icon over a title (+ hint)', () => {
    const p = new Rec(); emptyState(p, { rect: { x: 0, y: 0, w: 20, h: 6 }, icon: '∅', title: 'no runs', hint: 'press l', accent: 1, dim: 2 });
    expect(p.texts()).toEqual(['∅', 'no runs', 'press l']);
    expect(p.of('text')[0]![4]).toMatchObject({ align: 'c' });
  });
  it('scrollbar: track + a thumb sized to the visible fraction', () => {
    const p = new Rec(); scrollbar(p, { x: 0, y: 0, h: 10, total: 20, visible: 10, offset: 0, color: 1, track: 2 });
    expect(p.of('rect')).toHaveLength(2);
    expect(p.of('rect')[0]![5]).toMatchObject({ fill: 2 }); // track full height
    expect(p.of('rect')[1]![4]).toBe(5); // thumb = h * visible/total = 10 * 10/20
  });
  it('scrollbar: thumb moves down with offset', () => {
    const top = new Rec(); scrollbar(top, { x: 0, y: 0, h: 10, total: 20, visible: 5, offset: 0, color: 1, track: 2 });
    const bot = new Rec(); scrollbar(bot, { x: 0, y: 0, h: 10, total: 20, visible: 5, offset: 15, color: 1, track: 2 });
    expect(bot.of('rect')[1]![2]).toBeGreaterThan(top.of('rect')[1]![2] as number);
  });
});
