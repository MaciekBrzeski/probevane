// Tiny pure calculator lib — the node-vitest adapter's eval fixture.

export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new RangeError('division by zero');
  return a / b;
}

export function percent(value: number, total: number): number {
  if (total === 0) throw new RangeError('total must be non-zero');
  return Math.round((value / total) * 10000) / 100;
}
