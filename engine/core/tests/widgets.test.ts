import { describe, it, expect } from 'vitest';
import type { Painter, Caps, Pt, Style } from '../src/index';
import { frame, gauge, sparkline, nodeGraph } from '../src/index';

// A recording Painter — captures draw calls so widgets are testable without a
// backend (keeps @facet/core dependency-free).
type Call = [string, ...unknown[]];
class Rec implements Painter {
  calls: Call[] = [];
  constructor(public readonly caps: Caps) {}
  rect(x: number, y: number, w: number, h: number, st: Style) { this.calls.push(['rect', x, y, w, h, st]); }
  line(x0: number, y0: number, x1: number, y1: number, st: Style) { this.calls.push(['line', x0, y0, x1, y1, st]); }
  polyline(pts: Pt[], st: Style) { this.calls.push(['polyline', pts, st]); }
  polygon(pts: Pt[], st: Style) { this.calls.push(['polygon', pts, st]); }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, st: Style) { this.calls.push(['arc', cx, cy, r, a0, a1, st]); }
  text(x: number, y: number, s: string, st: Style) { this.calls.push(['text', x, y, s, st]); }
  push() {} pop() {}
  of(tag: string) { return this.calls.filter((c) => c[0] === tag); }
}
const CANVAS: Caps = { subpixel: true, curves: true, glyphGrid: false, cellW: 1, cellH: 1 };
const GRID: Caps = { ...CANVAS, glyphGrid: true };

describe('frame', () => {
  it('draws a filled bordered card + accent rail + spaced title', () => {
    const p = new Rec(CANVAS);
    frame(p, { x: 0, y: 0, w: 40, h: 12 }, { title: 'runs', accent: 0x4fd6ff, panel: 0x0b1220, line: 0x1b2a44 });
    expect(p.of('rect')).toHaveLength(2); // card + rail
    expect(p.of('rect')[0]![5]).toMatchObject({ fill: 0x0b1220, stroke: 0x1b2a44 });
    expect(p.of('rect')[1]![5]).toMatchObject({ fill: 0x4fd6ff }); // rail
    expect(p.of('text')[0]![3]).toBe('R U N S'); // letter-spaced
  });
});

describe('gauge', () => {
  it('draws a track arc, a value arc, and a centred %', () => {
    const p = new Rec(CANVAS);
    gauge(p, { cx: 10, cy: 10, r: 6, value: 0.5, accent: 0x2fe6a8, track: 0x1b2a44 });
    expect(p.of('arc')).toHaveLength(2);
    expect(p.of('arc')[0]![6]).toMatchObject({ stroke: 0x1b2a44 }); // full track
    expect(p.of('text')[0]![3]).toBe('50%');
    expect(p.of('text')[0]![4]).toMatchObject({ align: 'c' });
  });
  it('tags + pathLengths the value arc when asked (DOM animation hook)', () => {
    const p = new Rec(CANVAS);
    gauge(p, { cx: 0, cy: 0, r: 4, value: 0.5, accent: 1, track: 2, valueTag: 'gauge-arc', valuePathLength: 1 });
    expect(p.of('arc')[1]![6]).toMatchObject({ tag: 'gauge-arc', pathLength: 1 });
  });
  it('omits the value arc at 0 and clamps >1', () => {
    const z = new Rec(CANVAS); gauge(z, { cx: 0, cy: 0, r: 4, value: 0, accent: 1, track: 2 });
    expect(z.of('arc')).toHaveLength(1); // track only
    const o = new Rec(CANVAS); gauge(o, { cx: 0, cy: 0, r: 4, value: 5, accent: 1, track: 2 });
    expect(o.of('text')[0]![3]).toBe('100%');
  });
});

describe('sparkline', () => {
  it('emits one polyline through the scaled points', () => {
    const p = new Rec(CANVAS);
    sparkline(p, { rect: { x: 0, y: 0, w: 10, h: 4 }, points: [0, 2, 1, 4], accent: 0x4fd6ff });
    const poly = p.of('polyline')[0]!;
    const pts = poly[1] as Pt[];
    expect(pts).toHaveLength(4);
    expect(pts[0]!.x).toBe(0); expect(pts[3]!.x).toBe(10); // spans the width
    expect(pts[3]!.y).toBe(0);  // max value → top
  });
  it('draws a gradient area under the line when area:true', () => {
    const p = new Rec(CANVAS);
    sparkline(p, { rect: { x: 0, y: 0, w: 10, h: 4 }, points: [1, 2, 3], accent: 0x4fd6ff, area: true });
    expect(p.of('polygon')).toHaveLength(1);
    expect(p.of('polygon')[0]![2]).toMatchObject({ gradient: true });
    expect(p.of('polyline')).toHaveLength(1); // the line too
  });
  it('draws nothing for <2 points', () => {
    const p = new Rec(CANVAS); sparkline(p, { rect: { x: 0, y: 0, w: 5, h: 5 }, points: [1], accent: 1 });
    expect(p.calls).toHaveLength(0);
  });
});

describe('nodeGraph', () => {
  const nodes = [
    { id: 'a', label: 'alpha', deps: ['b'], accent: 0x4fd6ff },
    { id: 'b', label: 'beta', deps: [], accent: 0xc792ea },
  ];
  it('on a glyph grid: 1-row ( label ) text pills + an edge line', () => {
    const p = new Rec(GRID);
    nodeGraph(p, { rect: { x: 0, y: 0, w: 40, h: 8 }, nodes, edge: 0x1b2a44 });
    expect(p.of('rect')).toHaveLength(0);              // no boxes on a glyph grid
    expect(p.of('text').map((c) => c[3])).toContain('( alpha )');
    expect(p.of('line')).toHaveLength(1);              // b → a
  });
  it('on a pixel canvas: stroked rect pills + centred labels', () => {
    const p = new Rec(CANVAS);
    nodeGraph(p, { rect: { x: 0, y: 0, w: 40, h: 8 }, nodes, edge: 0x1b2a44 });
    expect(p.of('rect')).toHaveLength(2);              // a box per node
    expect(p.of('text')[0]![4]).toMatchObject({ align: 'c' });
  });
});
