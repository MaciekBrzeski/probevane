import { describe, it, expect } from 'vitest';
import { analyzeFile, DEFAULT_QUALITY } from '../src/quality/analyze.js';

// Regression: regex literals containing braces must NOT corrupt function-boundary
// detection. Before the stripLine regex fix, the `{` in `/[{,]/` was counted as a
// code brace and the first function "absorbed" the rest of the file.
describe('analyzer — regex literals do not break function boundaries', () => {
  it('detects two functions even when the first contains a brace-bearing regex', () => {
    const src = 'function a(s){ return /[{,]/.test(s); }\nfunction b(){ return 1; }\n';
    const fns = analyzeFile('t.ts', src, DEFAULT_QUALITY).functions;
    const names = fns.map((f) => f.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
    const a = fns.find((f) => f.name === 'a')!;
    expect(a.endLine).toBe(1); // `a` is one line; it must NOT absorb `b`
  });

  it('still treats division as division (no false regex)', () => {
    const src = 'function half(n: number){ return n / 2; }\n';
    const fns = analyzeFile('t.ts', src, DEFAULT_QUALITY).functions;
    expect(fns.map((f) => f.name)).toContain('half');
  });
});

describe('analyzer — long lines measure CODE width, not string/comment width', () => {
  it('a line long only due to a string literal is NOT flagged; long code IS', () => {
    const longStr = 'x'.repeat(200);
    const longCode = `const a = ${'b + '.repeat(40)}c;`; // ~160 chars of real code
    const src = `const msg = "${longStr}";\n${longCode}\n`;
    const r = analyzeFile('t.ts', src, DEFAULT_QUALITY);
    expect(r.longLineNos).not.toContain(1); // string literal — collapsed, not a code smell
    expect(r.longLineNos).toContain(2); // genuinely long code
  });

  it('a long trailing comment is NOT flagged', () => {
    const src = `const x = 1; // ${'note '.repeat(40)}\n`;
    expect(analyzeFile('t.ts', src, DEFAULT_QUALITY).longLineNos).toEqual([]);
  });
});
