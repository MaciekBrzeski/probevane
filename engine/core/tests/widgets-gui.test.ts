import { describe, it, expect } from 'vitest';
import type { Painter, Caps, Pt, Style } from '../src/index';
import {
  checkbox, radio, toggle, slider, textField, select,
  alert, banner, tooltip, dialog,
  avatar, chip, card, divider, stat, accordion, tree, timeline,
  breadcrumb, pagination, stepper, menu,
} from '../src/index';

type Call = [string, ...unknown[]];
class Rec implements Painter {
  calls: Call[] = [];
  readonly caps: Caps = { subpixel: true, curves: true, glyphGrid: false, cellW: 1, cellH: 1 };
  rect(x: number, y: number, w: number, h: number, st: Style) { this.calls.push(['rect', x, y, w, h, st]); }
  line(x0: number, y0: number, x1: number, y1: number, st: Style) { this.calls.push(['line', x0, y0, x1, y1, st]); }
  polyline() {} polygon() {} arc() {}
  text(x: number, y: number, s: string, st: Style) { this.calls.push(['text', x, y, s, st]); }
  push() {} pop() {}
  of(tag: string) { return this.calls.filter((c) => c[0] === tag); }
  texts() { return this.of('text').map((c) => c[3] as string); }
  joined() { return this.texts().join(' '); }
}

describe('inputs', () => {
  it('checkbox: ✓ box + accent when checked, [ ] when not', () => {
    const on = new Rec(); checkbox(on, { x: 0, y: 0, label: 'a', checked: true, accent: 1, dim: 2 });
    expect(on.texts()).toEqual(['[✓]', 'a']);
    expect(on.of('text')[0]![4]).toMatchObject({ fill: 1 });
    const off = new Rec(); checkbox(off, { x: 0, y: 0, label: 'a', checked: false, accent: 1, dim: 2 });
    expect(off.texts()[0]).toBe('[ ]');
  });
  it('radio: (•)/( ) by selected', () => {
    const a = new Rec(); radio(a, { x: 0, y: 0, label: 'x', selected: true, accent: 1, dim: 2 });
    expect(a.texts()[0]).toBe('(•)');
  });
  it('toggle: knob sits right when on, left when off', () => {
    const on = new Rec(); toggle(on, { x: 0, y: 0, on: true, accent: 1, track: 2, knob: 3 });
    const off = new Rec(); toggle(off, { x: 0, y: 0, on: false, accent: 1, track: 2, knob: 3 });
    expect(on.of('text')[0]![1]).toBeGreaterThan(off.of('text')[0]![1] as number);
    expect(on.of('rect')[0]![5]).toMatchObject({ fill: 1 }); // accent track
  });
  it('slider: track line + accent fill + knob at value', () => {
    const p = new Rec(); slider(p, { rect: { x: 0, y: 0, w: 20 }, value: 0.5, accent: 1, track: 2 });
    expect(p.of('line')).toHaveLength(2);
    expect(p.of('line')[1]![3]).toBe(10); // fill line ends at x=w*value
    expect(p.texts()).toContain('●');
  });
  it('textField: label + box + value with caret when focused', () => {
    const p = new Rec(); textField(p, { rect: { x: 0, y: 0, w: 12, h: 3 }, label: 'name', value: 'foo', focused: true, accent: 1, dim: 2, fg: 3 });
    expect(p.texts()).toContain('name');
    expect(p.texts().some((t) => t.startsWith('foo'))).toBe(true);
    expect(p.texts().some((t) => t.includes('▏'))).toBe(true);
    expect(p.of('rect')[0]![5]).toMatchObject({ stroke: 1 }); // focused border accent
  });
  it('select: value + ▾ chevron', () => {
    const p = new Rec(); select(p, { rect: { x: 0, y: 0, w: 12, h: 3 }, value: 'v', accent: 1, dim: 2, fg: 3 });
    expect(p.texts()).toContain('▾');
  });
});

describe('feedback', () => {
  it('alert: accent rail rect + title + message', () => {
    const p = new Rec(); alert(p, { rect: { x: 0, y: 0, w: 20, h: 4 }, icon: '✓', title: 'ok', message: 'done', accent: 1, fg: 3, dim: 2 });
    expect(p.of('rect')).toHaveLength(2); // border + rail
    expect(p.joined()).toContain('ok');
    expect(p.joined()).toContain('done');
  });
  it('banner: filled + centred text', () => {
    const p = new Rec(); banner(p, { rect: { x: 0, y: 0, w: 20, h: 3 }, text: 'hi', accent: 1, fg: 3 });
    expect(p.of('rect')[0]![5]).toMatchObject({ fill: 1 });
    expect(p.of('text')[0]![4]).toMatchObject({ align: 'c' });
  });
  it('tooltip: bubble sized to text + a tail', () => {
    const p = new Rec(); tooltip(p, { x: 0, y: 0, text: 'hi', accent: 1, fg: 3 });
    expect(p.of('rect')[0]![3]).toBe('hi'.length + 4);
    expect(p.texts()).toContain('▾');
  });
  it('dialog: one pill per action, primary is the last', () => {
    const p = new Rec(); dialog(p, { rect: { x: 0, y: 0, w: 30, h: 8 }, title: 't', body: 'b', actions: ['cancel', 'ok'], accent: 1, fg: 3, dim: 2, panel: 4 });
    expect(p.joined()).toContain('cancel');
    expect(p.joined()).toContain('ok');
    // primary (last) pill is accent-filled
    expect(p.of('rect').some((c) => (c[5] as Style).fill === 1)).toBe(true);
  });
});

describe('display', () => {
  it('avatar: filled chip + initials (max 2)', () => {
    const p = new Rec(); avatar(p, { x: 0, y: 0, initials: 'MBX', accent: 1, fg: 3 });
    expect(p.texts()[0]).toBe('MB');
  });
  it('chip: filled inverts fg/accent', () => {
    const f = new Rec(); chip(f, { x: 0, y: 0, text: 'e2e', accent: 1, fg: 3, filled: true });
    expect(f.of('rect')[0]![5]).toMatchObject({ fill: 1 });
    expect(f.of('text')[0]![4]).toMatchObject({ fill: 3 });
  });
  it('card: title + divider line + body lines', () => {
    const p = new Rec(); card(p, { rect: { x: 0, y: 0, w: 20, h: 6 }, title: 'T', lines: ['a', 'b'], accent: 1, fg: 3, dim: 2, panel: 4 });
    expect(p.of('line')).toHaveLength(1);
    expect(p.joined()).toContain('a');
    expect(p.joined()).toContain('b');
  });
  it('divider: label form splits the rule in two + centred label', () => {
    const p = new Rec(); divider(p, { x: 0, y: 0, w: 20, label: 'mid', line: 1, dim: 2 });
    expect(p.of('line')).toHaveLength(2);
    expect(p.joined()).toContain('mid');
    const plain = new Rec(); divider(plain, { x: 0, y: 0, w: 20, line: 1, dim: 2 });
    expect(plain.of('line')).toHaveLength(1);
  });
  it('stat: label, value, delta', () => {
    const p = new Rec(); stat(p, { x: 0, y: 0, label: 'cov', value: '99%', delta: '▲1', accent: 1, fg: 3, dim: 2 });
    expect(p.texts()).toEqual(['cov', '99%', '▲1']);
  });
  it('accordion: open row emits body, closed does not', () => {
    const p = new Rec(); accordion(p, { rect: { x: 0, y: 0, w: 20, h: 3 }, rows: [{ title: 'g', open: true, body: 'x' }, { title: 'h', open: false }], accent: 1, fg: 3, dim: 2 });
    expect(p.texts()).toContain('▾ g');
    expect(p.texts()).toContain('▸ h');
    expect(p.joined()).toContain('x');
  });
  it('tree: connectors by depth + last', () => {
    const p = new Rec(); tree(p, { x: 0, y: 0, rows: [{ depth: 0, label: 'root', last: false }, { depth: 1, label: 'child', last: true }], accent: 1, fg: 3, dim: 2 });
    expect(p.texts()).toContain('└─ ');
    expect(p.joined()).toContain('root');
  });
  it('timeline: ● for done, ○ for pending', () => {
    const p = new Rec(); timeline(p, { x: 0, y: 0, rows: [{ label: 'a', done: true }, { label: 'b', done: false }], accent: 1, fg: 3, dim: 2 });
    expect(p.texts()).toContain('●');
    expect(p.texts()).toContain('○');
  });
});

describe('navigation', () => {
  it('breadcrumb: last crumb accent, › between', () => {
    const p = new Rec(); breadcrumb(p, { x: 0, y: 0, crumbs: ['a', 'b'], accent: 1, dim: 2 });
    expect(p.joined()).toContain('›');
    const last = p.of('text').find((c) => c[3] === 'b')!;
    expect(last[4]).toMatchObject({ fill: 1, bold: true });
  });
  it('pagination: current is boxed [n] + chevrons', () => {
    const p = new Rec(); pagination(p, { x: 0, y: 0, pages: 3, current: 2, accent: 1, dim: 2 });
    expect(p.texts()).toContain('[2]');
    expect(p.texts()).toContain('‹');
    expect(p.texts()).toContain('›');
  });
  it('stepper: reached steps accent; connectors between', () => {
    const p = new Rec(); stepper(p, { x: 0, y: 0, steps: ['a', 'b', 'c'], current: 1, accent: 1, dim: 2, fg: 3 });
    expect(p.texts()).toContain('①');
    expect(p.of('line')).toHaveLength(2); // n-1 connectors
  });
  it('menu: selected row highlighted; shortcut right-aligned', () => {
    const p = new Rec(); menu(p, { rect: { x: 0, y: 0, w: 20, h: 4 }, items: [{ label: 'run', shortcut: '⏎' }, { label: 'x' }], selected: 0, accent: 1, fg: 3, dim: 2, panel: 4 });
    expect(p.joined()).toContain('run');
    expect(p.joined()).toContain('⏎');
    // selection highlight rect (accent fill) exists beyond the panel box
    expect(p.of('rect').some((c) => (c[5] as Style).fill === 1)).toBe(true);
  });
});
