import { describe, it, expect } from 'vitest';
import { pulse, mix, glow, gaugeBar } from '../src/tui/anim.js';

describe('pulse', () => {
  it('is 0 at the start of a period, 1 at half, 0 at the end', () => {
    expect(pulse(0, 1000)).toBeCloseTo(0);
    expect(pulse(500, 1000)).toBeCloseTo(1);
    expect(pulse(1000, 1000)).toBeCloseTo(0);
  });
  it('stays within [0,1] and tolerates a zero/negative period', () => {
    for (const t of [123, 777, 4001]) { const v = pulse(t, 1000); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(pulse(3, 0)).toBeGreaterThanOrEqual(0); // period<=0 → no divide-by-zero
  });
  it('normalises negative time into the period (cos is even, so ±period shifts are equivalent)', () => {
    expect(pulse(-500, 1000)).toBeCloseTo(1); // same as +500
    expect(pulse(-250, 1000)).toBeCloseTo(0.5);
  });
});

describe('mix', () => {
  it('returns the endpoints at k=0 and k=1', () => {
    expect(mix(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mix(0x000000, 0xffffff, 1)).toBe(0xffffff);
  });
  it('interpolates each channel at the midpoint', () => {
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mix(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
  });
  it('clamps k out of range', () => {
    expect(mix(0x102030, 0xffffff, -1)).toBe(0x102030);
    expect(mix(0x102030, 0xffffff, 2)).toBe(0xffffff);
  });
});

describe('glow', () => {
  it('brightens toward white (never past 0.6 of the way)', () => {
    expect(glow(0x000000, 1)).toBe(0x999999); // 255*0.6 = 153 = 0x99
    expect(glow(0x4fd6ff, 0)).toBe(0x4fd6ff); // k=0 → unchanged
  });
});

describe('gaugeBar', () => {
  it('fills proportional to value, padded with ░ inside brackets', () => {
    expect(gaugeBar(1, 4, 1)).toBe('⟦████⟧');
    expect(gaugeBar(0.5, 4, 1)).toBe('⟦██░░⟧');
    expect(gaugeBar(0, 4, 1)).toBe('⟦░░░░⟧');
  });
  it('reveal sweeps the fill in (0 → empty)', () => {
    expect(gaugeBar(1, 4, 0)).toBe('⟦░░░░⟧');
    expect(gaugeBar(1, 4, 0.5)).toBe('⟦██░░⟧');
  });
  it('clamps value and width', () => {
    expect(gaugeBar(9, 3, 1)).toBe('⟦███⟧'); // value>1 → full
    expect(gaugeBar(0.5, 0, 1)).toMatch(/^⟦[█░]⟧$/); // width floored to 1
  });
});
