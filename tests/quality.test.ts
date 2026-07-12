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
    const code = [
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
    ].join('\n');
    const fns = detectFunctions(code);
    const names = fns.map((f) => f.name).sort();
    expect(names).toEqual(['bar', 'foo', 'method']);
    expect(fns.find((f) => f.name === 'oneLine')).toBeUndefined();
  });

  it('measures params and complexity', () => {
    const code = ['function f(a, b, c) {', '  if (a && b) return 1;', '  for (;;) {}', '  return c;', '}'].join('\n');
    const f = detectFunctions(code)[0];
    expect(f.params).toBe(3);
    // base 1 + if + && + for = 4
    expect(f.complexity).toBe(4);
  });

  it('counts destructured/defaulted params at top level only', () => {
    const code = ['function g({ a, b }, c = [1, 2]) {', '  return c;', '}'].join('\n');
    expect(detectFunctions(code)[0].params).toBe(2);
  });

  it('does not run an expression arrow away into the next function', () => {
    // regression: a one-liner arrow followed by a real function must not absorb it.
    const code = ['const round = (n) => Math.round(n);', 'function big() {', '  return 1;', '}'].join('\n');
    const fns = detectFunctions(code);
    expect(fns.map((f) => f.name)).toEqual(['big']);
    expect(fns[0].loc).toBe(3); // big is 3 lines, not absorbing round
  });

  it('tracks nesting depth', () => {
    const code = ['function n() {', '  if (a) {', '    if (b) {', '      x();', '    }', '  }', '}'].join('\n');
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
    const { dups } = findDuplication(
      [
        { file: 'a.ts', code: fileA },
        { file: 'b.ts', code: fileB },
      ],
      3,
    );
    expect(dups.length).toBeGreaterThan(0);
    expect(dups[0].count).toBeGreaterThanOrEqual(2);
  });

  it('reports a maximal block, not overlapping fixed-size windows', () => {
    // a 5-line identical block with minLines 3 → ONE dup of lines:5, not 3 windows
    const block = ['const a = f(1);', 'const b = f(2);', 'const c = f(3);', 'const d = f(4);', 'const e = f(5);'];
    const fileA = stripToCode(['function one() {', ...block, 'return a;', '}']);
    const fileB = stripToCode(['function two() {', ...block, 'return e;', '}']);
    const { dups } = findDuplication(
      [
        { file: 'a.ts', code: fileA },
        { file: 'b.ts', code: fileB },
      ],
      3,
    );
    expect(dups).toHaveLength(1);
    expect(dups[0].lines).toBe(5);
    expect(dups[0].count).toBe(2);
  });

  it('ignores mostly-trivial blocks', () => {
    const trivial = stripToCode(['{', '}', '{', '}', '{', '}']);
    const { dups } = findDuplication(
      [
        { file: 'a.ts', code: trivial },
        { file: 'b.ts', code: trivial },
      ],
      3,
    );
    expect(dups).toEqual([]);
  });
});

describe('cognitive complexity', () => {
  it('weights nested branches more than flat ones', () => {
    const flat = ['function f(a, b, c) {', '  if (a) x();', '  if (b) y();', '  if (c) z();', '}'].join('\n');
    const nested = ['function g(a, b, c) {', '  if (a) {', '    if (b) {', '      if (c) z();', '    }', '  }', '}'].join('\n');
    const cf = detectFunctions(flat)[0];
    const cg = detectFunctions(nested)[0];
    // same 3 ifs ≈ same cyclomatic, but nested cognitive is higher
    expect(cf.cognitive).toBe(3); // 1+1+1 at depth 0
    expect(cg.cognitive).toBeGreaterThan(cf.cognitive); // 1 + 2 + 3 = 6
  });

  it('flags a cognitively-complex function (warn)', () => {
    const nested = ['function deep(a, b, c, d) {', '  if (a) { if (b) { if (c) { if (d) {', '    work();', '  }}}}', '}'].join('\n');
    const r = analyzeProject([{ file: 'x.ts', source: nested }], { ...DEFAULT_QUALITY, maxCognitive: 3 });
    expect(r.violations.some((v) => v.rule === 'cognitive')).toBe(true);
  });
});

describe('real line numbers + comment-scoped debt', () => {
  it('points long-lines and debt at the actual line', () => {
    const src = ['const ok = 1;', '// TODO fix later', `const wide = ${'9'.repeat(140)};`].join('\n');
    const r = analyzeProject([{ file: 'd.ts', source: src }]);
    const debt = r.violations.find((v) => v.rule === 'debt');
    const long = r.violations.find((v) => v.rule === 'long-lines');
    expect(debt?.line).toBe(2);
    expect(long?.line).toBe(3);
  });

  it('does NOT flag debt markers in strings/identifiers (comment-only)', () => {
    const src = ['const TODO_LIST = [];', 'const s = "TODO: not a real marker";', 'function f() { return TODO_LIST; }'].join('\n');
    const r = analyzeProject([{ file: 'i.ts', source: src }]);
    expect(r.violations.some((v) => v.rule === 'debt')).toBe(false);
  });
});

describe('analyzeFile', () => {
  it('counts imports', () => {
    const src = "import a from 'a';\nimport b from 'b';\nconst r = require('c');\n";
    expect(analyzeFile('x.ts', src, DEFAULT_QUALITY).imports).toBe(3);
  });
});

describe('doc rules + comment-excluded sizes', () => {
  it('undocumented function → doc-comment warn; documented → clean', () => {
    const bare = 'function foo() {\n  return 1;\n}\n';
    const r1 = analyzeProject([{ file: 'a.ts', source: bare }]);
    expect(r1.violations.map((v) => v.rule)).toContain('doc-comment');
    const docd = '/** adds one */\nfunction foo() {\n  return 1;\n}\n';
    expect(analyzeProject([{ file: 'a.ts', source: docd }]).violations).toEqual([]);
    // line comments count as docs too
    const slash = '// adds one\nconst foo = () => {\n  return 1;\n};\n';
    expect(analyzeProject([{ file: 'a.ts', source: slash }]).violations).toEqual([]);
  });

  it('nested functions are exempt — the parent doc covers the cluster', () => {
    const src = '/** outer */\nfunction outer() {\n  const inner = () => {\n    return 2;\n  };\n  return inner();\n}\n';
    expect(analyzeProject([{ file: 'a.ts', source: src }]).violations).toEqual([]);
  });

  it('exported interface/type without a shape comment → type-doc warn; local or documented → clean', () => {
    const bare = 'export interface Foo {\n  a: number;\n}\nexport type Bar = { b: string };\n';
    const rules = analyzeProject([{ file: 'a.ts', source: bare }]).violations.map((v) => v.rule);
    expect(rules.filter((r) => r === 'type-doc').length).toBe(2);
    const docd = '/** shape */\nexport interface Foo {\n  a: number;\n}\n';
    expect(analyzeProject([{ file: 'a.ts', source: docd }]).violations).toEqual([]);
    const local = 'interface Hidden {\n  a: number;\n}\nexport const use = (h: Hidden) => {\n  return h.a;\n};\n// used\n';
    expect(analyzeProject([{ file: 'a.ts', source: local }]).violations.map((v) => v.rule)).not.toContain('type-doc');
  });

  it('requireDocs: false disables both rules', () => {
    const bare = 'function foo() {\n  return 1;\n}\nexport interface Foo {\n  a: number;\n}\n';
    const r = analyzeProject([{ file: 'a.ts', source: bare }], { ...DEFAULT_QUALITY, requireDocs: false });
    expect(r.violations).toEqual([]);
  });

  it('comment-only lines are excluded from fn-size and file-size', () => {
    // fn: 2 code lines + 3 comment lines inside; maxFnLoc 4 → passes only if comments excluded
    const fn = [
      '/** docs */',
      'function foo() {',
      '  // one',
      '  // two',
      '  // three',
      '  return 1;',
      '}',
    ].join('\n');
    const r = analyzeProject([{ file: 'a.ts', source: fn }], { ...DEFAULT_QUALITY, maxFnLoc: 4 });
    expect(r.violations.map((v) => v.rule)).not.toContain('fn-size');
    // file: 6 code lines + comments past the ceiling → file-size only counts code
    const pad = Array.from({ length: 10 }, (_, i) => `// c${i}`).join('\n');
    const file = `${pad}\n/** d */\nexport const x = 1;\n`;
    const rf = analyzeProject([{ file: 'b.ts', source: file }], { ...DEFAULT_QUALITY, maxFileLoc: 5 });
    expect(rf.violations.map((v) => v.rule)).not.toContain('file-size');
  });

  it('pre-computed functions without hasDoc (e.g. Python) skip the doc rule', () => {
    const fns = [{ name: 'f', startLine: 1, endLine: 3, loc: 3, params: 0, complexity: 1, cognitive: 0, nesting: 0 }];
    const r = analyzeProject([{ file: 'm.py', source: 'def f():\n    # c\n    return 1\n', functions: fns }]);
    expect(r.violations.map((v) => v.rule)).not.toContain('doc-comment');
  });
});
