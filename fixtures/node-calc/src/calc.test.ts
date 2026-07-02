import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide, percent } from './calc';

describe('add', () => {
  it('adds positives', () => {
    expect(add(2, 3)).toBe(5);
  });
  it('adds negatives', () => {
    expect(add(-2, -3)).toBe(-5);
  });
});

describe('subtract', () => {
  it('subtracts', () => {
    expect(subtract(5, 3)).toBe(2);
  });
});

describe('multiply', () => {
  it('multiplies', () => {
    expect(multiply(4, 3)).toBe(12);
  });
  it('zero annihilates', () => {
    expect(multiply(4, 0)).toBe(0);
  });
});

describe('divide', () => {
  it('divides evenly', () => {
    expect(divide(10, 4)).toBe(2.5);
  });
  it('throws on division by zero', () => {
    expect(() => divide(1, 0)).toThrow(RangeError);
  });
});

describe('percent', () => {
  it('rounds to 2 decimal places', () => {
    expect(percent(1, 3)).toBe(33.33);
  });
  it('throws on zero total', () => {
    expect(() => percent(1, 0)).toThrow(RangeError);
  });
});
