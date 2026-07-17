import { describe, it, expect } from 'vitest';
import { mergeResults } from '../src/adapters/vitest-runner.js';
import type { RunResult } from '../src/adapters/adapter.js';

const r = (passed: number, failed: number, skipped: number, green: boolean, raw = ''): RunResult =>
  ({ passed, failed, skipped, green, raw });

describe('vitest-runner mergeResults', () => {
  it('passes a single result through unchanged', () => {
    const one = r(3, 0, 1, true, 'out');
    expect(mergeResults([one])).toBe(one);
  });

  it('sums the tallies and joins raw across parts', () => {
    const merged = mergeResults([r(2, 1, 0, false, 'A'), r(3, 0, 2, true, 'B')]);
    expect(merged).toEqual({ passed: 5, failed: 1, skipped: 2, green: false, raw: 'A\n---\nB' });
  });

  it('is green only when every part is green', () => {
    expect(mergeResults([r(1, 0, 0, true), r(1, 0, 0, true)]).green).toBe(true);
    expect(mergeResults([r(1, 0, 0, true), r(0, 1, 0, false)]).green).toBe(false);
  });
});
