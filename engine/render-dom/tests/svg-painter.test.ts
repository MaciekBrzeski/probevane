import { describe, it, expect } from 'vitest';
import { SvgPainter } from '../src/index';

describe('SvgPainter', () => {
  it('emits rect/line/text/arc primitives with the packed colours as #hex', () => {
    const p = new SvgPainter(100, 40);
    p.rect(2, 2, 40, 20, { fill: 0x0b1220, stroke: 0x4fd6ff, width: 2 });
    p.line(0, 0, 50, 0, { stroke: 0x2fe6a8 });
    p.arc(50, 20, 10, 0, Math.PI, { stroke: 0xc792ea });
    p.text(50, 20, 'HELLO', { fill: 0xcfe3f5, align: 'c', bold: true });
    const tags = p.items.map((i) => i.tag);
    expect(tags).toEqual(['rect', 'line', 'path', 'text']);
    expect(p.items[0]!.attrs.fill).toBe('#0b1220');
    expect(p.items[0]!.attrs.stroke).toBe('#4fd6ff');
    expect(p.items[2]!.attrs.d).toMatch(/^M .* A 10 10 /); // arc path
    const text = p.items[3]!;
    expect(text.text).toBe('HELLO');
    expect(text.attrs['text-anchor']).toBe('middle');
    expect(text.attrs['font-weight']).toBe(700);
  });

  it('honours SVG-hint style: tag→class, pathLength, data-*', () => {
    const p = new SvgPainter(10, 10);
    p.line(0, 0, 5, 5, { stroke: 0x4fd6ff, tag: 'spark-line', pathLength: 1, data: { node: 'a' } });
    const a = p.items[0]!.attrs;
    expect(a.class).toBe('spark-line');
    expect(a.pathLength).toBe(1);
    expect(a['data-node']).toBe('a');
    expect(a['stroke-linecap']).toBe('round');
  });

  it('polygon + gradient registers a def and fills url()', () => {
    const p = new SvgPainter(10, 10);
    p.polygon([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 10 }], { fill: 0x4fd6ff, gradient: true });
    expect(p.items[0]!.tag).toBe('polygon');
    expect(String(p.items[0]!.attrs.fill)).toBe('url(#fg0)');
    expect(p.toSvg()).toContain('<linearGradient id="fg0"');
  });

  it('circle (spark end dot)', () => {
    const p = new SvgPainter(10, 10);
    p.circle(5, 5, 2, { fill: 0xffffff });
    expect(p.items[0]!.tag).toBe('circle');
    expect(p.items[0]!.attrs.r).toBe(2);
  });

  it('serializes to an SVG string with a viewBox, escaping text', () => {
    const p = new SvgPainter(20, 10);
    p.text(0, 5, 'a<b>', { fill: 0xffffff });
    const svg = p.toSvg();
    expect(svg).toMatch(/^<svg viewBox="0 0 20 10"/);
    expect(svg).toContain('a&lt;b&gt;');
  });
});
