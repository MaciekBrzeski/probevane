/** Pure counter logic — easy unit targets. */
export function increment(n: number, step = 1): number {
  return n + step;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function isEven(n: number): boolean {
  return n % 2 === 0;
}
