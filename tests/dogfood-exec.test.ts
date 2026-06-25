import { describe, it, expect } from 'vitest';
import { capOutput } from '../src/util/exec.js';

// Helper: build a string of N numbered lines "L0\nL1\n...L(n-1)"
function makeLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `L${i}`).join('\n');
}

describe('capOutput', () => {
  it('returns an empty string unchanged', () => {
    expect(capOutput('')).toBe('');
  });

  it('returns a single-line string unchanged', () => {
    expect(capOutput('hello')).toBe('hello');
  });

  it('returns a short multi-line string unchanged (below threshold)', () => {
    const s = 'a\nb\nc';
    expect(capOutput(s, 40, 60)).toBe(s);
  });

  it('returns a string with exactly headLines+tailLines lines unchanged (boundary)', () => {
    // 100 lines total, headLines=40, tailLines=60 → exactly at boundary, no elision
    const s = makeLines(100);
    expect(capOutput(s, 40, 60)).toBe(s);
  });

  it('elides the middle when lines exceed headLines+tailLines', () => {
    // 101 lines: one over the 40+60 boundary
    const s = makeLines(101);
    const result = capOutput(s, 40, 60);
    expect(result).not.toBe(s);
    expect(result).toContain('lines elided');
  });

  it('preserves head and tail content in the elided output', () => {
    // 200 lines, head=5, tail=5 → 190 elided
    const s = makeLines(200);
    const result = capOutput(s, 5, 5);
    // first line present
    expect(result.startsWith('L0\n')).toBe(true);
    // last line present
    expect(result).toContain('L199');
    // elision marker with correct count
    expect(result).toContain('[190 lines elided]');
  });

  it('embeds the exact elided-line count in the output', () => {
    // 10 lines, head=2, tail=3 → 5 elided
    const s = makeLines(10);
    const result = capOutput(s, 2, 3);
    expect(result).toContain('[5 lines elided]');
  });

  it('does not include elided lines in the output', () => {
    // 20 lines L0..L19, head=3, tail=3 → L3..L16 should NOT appear
    const s = makeLines(20);
    const result = capOutput(s, 3, 3);
    // middle lines removed
    expect(result).not.toContain('L3\n');
    expect(result).not.toContain('L16\n');
    // head lines present
    expect(result).toContain('L0');
    expect(result).toContain('L2');
    // tail lines present
    expect(result).toContain('L17');
    expect(result).toContain('L19');
  });

  it('uses default parameters (headLines=40, tailLines=60) when not supplied', () => {
    // 100 lines: should pass through unchanged with defaults
    const s = makeLines(100);
    expect(capOutput(s)).toBe(s);

    // 101 lines: should elide with defaults
    const s2 = makeLines(101);
    expect(capOutput(s2)).toContain('lines elided');
  });

  it('custom headLines=3 tailLines=3 elides correctly for 20-line input', () => {
    const s = makeLines(20);
    const result = capOutput(s, 3, 3);
    // 20 - 3 - 3 = 14 elided
    expect(result).toContain('[14 lines elided]');
  });
});
