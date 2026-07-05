import { describe, it, expect } from 'vitest';
import type { Painter, Caps, Pt, Style } from '../src/index';
import { button, badge, progress, spinner, list, table, tabs, keyValue } from '../src/index';

type Call = [string, ...unknown[]];
class Rec implements Painter {
  calls: Call[] = [];
  readonly caps: Caps = { subpixel: true, curves: true, glyphGrid: false, cellW: 1, cellH: 1 };
  rect(x: number, y: number, w: number, h: number, st: Style) { this.calls.push(['rect', x, y, w, h, st]); }
  line() {} polyline() {} polygon() {}
  arc() {}
  text(x: number, y: number, s: string, st: Style) { this.calls.push(['text', x, y, s, st]); }
  push() {} pop() {}
  of(tag: string) { return this.calls.filter((c) => c[0] === tag); }
  texts() { return this.of('text').map((c) => c[3] as string); }
}

describe('controls', () => {
  it('button: box + centred label; filled inverts', () => {
    const p = new Rec(); button(p, { rect: { x: 0, y: 0, w: 12, h: 3 }, label: 'RUN', accent: 0x4fd6ff, fg: 0x04070f, filled: true });
    expect(p.of('rect')[0]![5]).toMatchObject({ fill: 0x4fd6ff });
    expect(p.of('text')[0]).toMatchObject({ 3: 'RUN' });
    expect(p.of('text')[0]![4]).toMatchObject({ align: 'c', fill: 0x04070f });
  });
  it('badge: filled pill sized to the text', () => {
    const p = new Rec(); badge(p, { x: 2, y: 1, text: '9', accent: 0xff5d6c, fg: 0xffffff });
    expect(p.of('rect')[0]![3]).toBe(3); // width = len+2
    expect(p.texts()).toContain('9');
  });
  it('progress: track fill + accent fill scaled to value', () => {
    const p = new Rec(); progress(p, { rect: { x: 0, y: 0, w: 20, h: 1 }, value: 0.5, accent: 0x2fe6a8, track: 0x1b2a44 });
    expect(p.of('rect')).toHaveLength(2);
    expect(p.of('rect')[0]![5]).toMatchObject({ fill: 0x1b2a44 }); // track full width
    expect(p.of('rect')[1]![3]).toBe(10); // fill = w*value
  });
  it('progress: no fill at 0', () => {
    const p = new Rec(); progress(p, { rect: { x: 0, y: 0, w: 20, h: 1 }, value: 0, accent: 1, track: 2 });
    expect(p.of('rect')).toHaveLength(1);
  });
  it('spinner: frame advances with t', () => {
    const a = new Rec(); spinner(a, { x: 0, y: 0, accent: 1 }, 0);
    const b = new Rec(); spinner(b, { x: 0, y: 0, accent: 1 }, 160);
    expect(a.texts()[0]).not.toBe(b.texts()[0]);
  });
});

describe('collections', () => {
  it('list: marks the selected row', () => {
    const p = new Rec(); list(p, { rect: { x: 0, y: 0, w: 20, h: 3 }, items: ['a', 'b', 'c'], selected: 1, accent: 0x4fd6ff, dim: 0x7d93ad });
    expect(p.texts()).toEqual(['  a', '▸ b', '  c']);
    expect(p.of('text')[1]![4]).toMatchObject({ fill: 0x4fd6ff, bold: true });
  });
  it('table: header row + data rows in columns', () => {
    const p = new Rec();
    table(p, { rect: { x: 0, y: 0, w: 30, h: 3 }, columns: [{ header: 'k', width: 6 }, { header: 'v', width: 6 }], rows: [['a', '1'], ['b', '2']], accent: 1, dim: 2, fg: 3 });
    expect(p.texts()).toEqual(expect.arrayContaining(['k', 'v', 'a', '1', 'b', '2']));
    // second column offset past the first (width+gap)
    const v = p.of('text').find((c) => c[3] === 'v')!;
    expect(v[1]).toBe(7);
  });
  it('tabs: active tab gets » « markers', () => {
    const p = new Rec(); tabs(p, { x: 0, y: 0, tabs: ['one', 'two'], active: 1, accent: 1, dim: 2 });
    expect(p.texts()).toEqual(['  one  ', '» two «']);
  });
  it('keyValue: aligned key/value rows', () => {
    const p = new Rec(); keyValue(p, { rect: { x: 0, y: 0, w: 20, h: 2 }, pairs: [{ k: 'cost', v: '$10' }], keyW: 8, accent: 1, dim: 2 });
    expect(p.texts()).toEqual(['cost', '$10']);
    expect(p.of('text')[1]![1]).toBe(8); // value at keyW offset
  });
});
