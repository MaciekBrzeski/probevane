import { describe, it, expect } from 'vitest';
import {
  analyzeProject,
  analyzeFile,
  detectFunctions,
  stripToCode,
  findDuplication,
  DEFAULT_QUALITY,
} from '../src/quality/analyze.js';

describe('stripToCode', () => {
  it('blanks line + block comments and string contents', () => {
    const out = stripToCode([
      'const a = "hello {"; // trailing }',
      '/* block } { */ const b = 1;',
      "const c = 'a } b';",
    ]);
    // braces inside strings/comments must not survive
    expect(out.join('\n')).not.toContain('hello');
    expect(out[0]).not.toContain('}'); // the } was inside a string + comment
    expect(out[1]).toContain('const b = 1;');
  });
});

describe('detectFunctions', () => {
  it('finds named functions, arrow-block, and methods; skips expression arrows', () => {
    const code = stripToCode(
      [
        'function foo(a, b) {',
        '  return a + b;',
        '}',
        'const bar = (x) => {',
        '  if (x) return 1;',
        '  return 0;',
        '};',
        'const oneLine = (n) => n * 2;', // expression arrow — skipped
        'class C {',
        '  method(p, q, r) {',
        '    return p;',
        '  }',
        '}',
      ],
    );
    const fns = detectFunctions(code);
    const names = fns.map((f) => f.name).sort();
    expect(names).toEqual(['bar', 'foo', 'method']);
    expect(fns.find((f) => f.name === 'oneLine')).toBeUndefined();
  });

  it('measures params and complexity', () => {
    const code = stripToCode(
      ['function f(a, b, c) {', '  if (a && b) return 1;', '  for (;;) {}', '  return c;', '}'],
    );
    const f = detectFunctions(code)[0];
    expect(f.params).toBe(3);
    // base 1 + if + && + for = 4
    expect(f.complexity).toBe(4);
  });

  it('counts destructured/defaulted params at top level only', () => {
    const code = stripToCode(['function g({ a, b }, c = [1, 2]) {', '  return c;', '}']);
    expect(detectFunctions(code)[0].params).toBe(2);
  });

  it('does not run an expression arrow away into the next function', () => {
    // regression: a one-liner arrow followed by a real function must not absorb it.
    const code = stripToCode(
      ['const round = (n) => Math.round(n);', 'function big() {', '  return 1;', '}'],
    );
    const fns = detectFunctions(code);
    expect(fns.map((f) => f.name)).toEqual(['big']);
    expect(fns[0].loc).toBe(3); // big is 3 lines, not absorbing round
  });

  it('tracks nesting depth', () => {
    const code = stripToCode(
      ['function n() {', '  if (a) {', '    if (b) {', '      x();', '    }', '  }', '}'],
    );
    expect(detectFunctions(code)[0].nesting).toBe(2);
  });
});

describe('analyzeProject', () => {
  it('flags file-size, fn-size, params, and grades down', () => {
    const big = 'x\n'.repeat(20);
    const longFn = ['function huge(a, b, c, d, e, f) {', big, '}'].join('\n');
    const r = analyzeProject([{ file: 'a.ts', source: longFn }], {
      ...DEFAULT_QUALITY,
      maxFileLoc: 10,
      maxFnLoc: 10,
      maxParams: 3,
    });
    const rules = r.violations.map((v) => v.rule);
    expect(rules).toContain('file-size');
    expect(rules).toContain('fn-size');
    expect(rules).toContain('params');
    expect(r.errors).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
  });

  it('a clean small file scores 100', () => {
    const r = analyzeProject([
      { file: 'ok.ts', source: 'export const add = (a, b) => a + b;\n' },
    ]);
    expect(r.violations).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('flags debt markers and long lines', () => {
    const src = `// TODO fix this\nconst x = ${'1'.repeat(140)};\n`;
    const r = analyzeProject([{ file: 'd.ts', source: src }]);
    const rules = r.violations.map((v) => v.rule);
    expect(rules).toContain('debt');
    expect(rules).toContain('long-lines');
  });
});

describe('findDuplication', () => {
  it('detects a repeated block across files', () => {
    const block = ['const a = compute(1);', 'const b = compute(2);', 'const c = compute(3);'];
    const fileA = stripToCode(['function one() {', ...block, 'return a;', '}']);
    const fileB = stripToCode(['function two() {', ...block, 'return b;', '}']);
    const dups = findDuplication(
      [
        { file: 'a.ts', code: fileA },
        { file: 'b.ts', code: fileB },
      ],
      3,
    );
    expect(dups.length).toBeGreaterThan(0);
    expect(dups[0].count).toBeGreaterThanOrEqual(2);
  });

  it('ignores mostly-trivial blocks', () => {
    const trivial = stripToCode(['{', '}', '{', '}', '{', '}']);
    const dups = findDuplication(
      [
        { file: 'a.ts', code: trivial },
        { file: 'b.ts', code: trivial },
      ],
      3,
    );
    expect(dups).toEqual([]);
  });
});

describe('analyzeFile', () => {
  it('counts imports', () => {
    const src = "import a from 'a';\nimport b from 'b';\nconst r = require('c');\n";
    expect(analyzeFile('x.ts', src, DEFAULT_QUALITY).imports).toBe(3);
  });
});
