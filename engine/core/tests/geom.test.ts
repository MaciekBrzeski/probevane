import { describe, it, expect } from 'vitest';
import { spanToBox, spanToCss, clamp } from '../src/geom';

describe('spanToBox', () => {
  it('maps a fractional span into an area (float, unrounded)', () => {
    expect(spanToBox([0, 0, 1, 0.5], { x: 0, y: 10, w: 80, h: 20 })).toEqual({ x: 0, y: 10, w: 80, h: 10 });
    expect(spanToBox([0.5, 0.5, 1, 1], { x: 0, y: 0, w: 80, h: 20 })).toEqual({ x: 40, y: 10, w: 40, h: 10 });
  });
});

describe('spanToCss', () => {
  it('maps the same span to an absolute-inset rule', () => {
    expect(spanToCss([0, 0.5, 0.5, 1])).toBe('left:0.00%;top:50.00%;width:50.00%;height:50.00%');
  });
});

describe('clamp', () => {
  it('bounds a value', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
