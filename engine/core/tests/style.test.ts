import { describe, it, expect } from 'vitest';
import { rgb, hex, mix, glow, pulse } from '../src/style';

describe('colour', () => {
  it('splits + hex-formats packed colours', () => {
    expect(rgb(0x4fd6ff)).toEqual([0x4f, 0xd6, 0xff]);
    expect(hex(0x4fd6ff)).toBe('#4fd6ff');
    expect(hex(0x0b1220)).toBe('#0b1220'); // zero-padded
  });
  it('mix returns endpoints + interpolates each channel', () => {
    expect(mix(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mix(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mix(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
  });
  it('mix clamps k', () => {
    expect(mix(0x102030, 0xffffff, -1)).toBe(0x102030);
    expect(mix(0x102030, 0xffffff, 2)).toBe(0xffffff);
  });
  it('glow brightens toward white (≤0.6 of the way)', () => {
    expect(glow(0x000000, 1)).toBe(0x999999); // round(255*0.6)=153
    expect(glow(0x4fd6ff, 0)).toBe(0x4fd6ff);
  });
});

describe('pulse', () => {
  it('is 0 at period start, 1 at half, 0 at end', () => {
    expect(pulse(0, 1000)).toBeCloseTo(0);
    expect(pulse(500, 1000)).toBeCloseTo(1);
    expect(pulse(1000, 1000)).toBeCloseTo(0);
  });
  it('normalises negative time, tolerates a zero period', () => {
    expect(pulse(-500, 1000)).toBeCloseTo(1);
    expect(pulse(3, 0)).toBeGreaterThanOrEqual(0);
  });
});
