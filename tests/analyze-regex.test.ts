import { describe, it, expect } from 'vitest';
import { analyzeFile, DEFAULT_QUALITY, findDuplication, stripToCode } from '../src/quality/analyze.js';

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

describe('analyzer — multi-line template literals do not leak as control flow', () => {
  it('control-flow text inside a multi-line template is not counted; the next function stays separate', () => {
    const src = [
      'function gen() {',
      '  return `',
      '  for (const x of y) {',
      '    if (x) { if (y) { while (z) { run(); } } }',
      '  }',
      '  `;',
      '}',
      'function other() { return 1; }',
      '',
    ].join('\n');
    const fns = analyzeFile('t.ts', src, DEFAULT_QUALITY).functions;
    const names = fns.map((f) => f.name);
    expect(names).toContain('gen');
    expect(names).toContain('other'); // gen must NOT absorb other through the template
    const gen = fns.find((f) => f.name === 'gen')!;
    expect(gen.cognitive).toBeLessThan(5); // the template's fake for/if/while don't count
    expect(gen.nesting).toBeLessThanOrEqual(1);
  });
});

describe('analyzer — duplication ignores distinct data rows (keepStrings)', () => {
  // 8 rows, same SHAPE but different string content (a command-table-like array).
  const rows = Array.from({ length: 8 }, (_, i) => `  { name: 'cmd${i}', summary: 'does thing ${i}', usage: 'run ${i}' },`);

  it('does not flag a data table as duplication (strings preserved)', () => {
    const code = stripToCode(rows, true); // keepStrings — production dup path
    expect(findDuplication([{ file: 'catalog.ts', code }], 6).dups).toEqual([]);
  });

  it('the old string-collapsing path WOULD have mis-flagged it (regression guard)', () => {
    const collapsed = stripToCode(rows); // default collapse → every row becomes identical
    expect(findDuplication([{ file: 'catalog.ts', code: collapsed }], 6).dups.length).toBeGreaterThan(0);
  });

  it('still catches genuine copy-pasted code (identical incl. strings)', () => {
    const block = ['  const a = load("x");', '  const b = parse(a);', '  const c = render(b);', '  const d = c + 1;', '  const e = d * 2;', '  return e;'];
    const fileA = stripToCode(['function one() {', ...block, '}'], true);
    const fileB = stripToCode(['function two() {', ...block, '}'], true);
    expect(findDuplication([{ file: 'a.ts', code: fileA }, { file: 'b.ts', code: fileB }], 6).dups.length).toBeGreaterThan(0);
  });
});

describe('analyzer — debt markers: annotations not prose/docs', () => {
  const debtOf = (src: string) => analyzeFile('t.ts', src, DEFAULT_QUALITY).debt;

  it('flags a real marker (comment-leading or colon-suffixed)', () => {
    expect(debtOf('// TODO: fix this\nconst x = 1;\n')).toBe(1);
    expect(debtOf('const y = 2; // FIXME later\n')).toBe(1);
  });

  it('does NOT flag a slash-list / prose mention (the analyzer documenting its own markers)', () => {
    expect(debtOf('// flag TODO/FIXME/HACK/XXX markers\n')).toBe(0);
    expect(debtOf('// debt markers (TODO/FIXME) are comment-scoped\n')).toBe(0);
  });
});

describe('analyzer — duplication skips import blocks (structural, not logic dup)', () => {
  it('two files sharing an identical import block but different bodies are not flagged', () => {
    const imports = [
      "import { readdir, readFile } from 'node:fs/promises';",
      "import { join } from 'node:path';",
      'import type {',
      '  StackAdapter,',
      '  TestKind,',
      '  RunResult,',
      '} from "../adapter.js";',
    ];
    const a = stripToCode([...imports, 'export function aaa() { return 1; }'], true);
    const b = stripToCode([...imports, 'export function bbb() { return 2; }'], true);
    expect(findDuplication([{ file: 'a.ts', code: a }, { file: 'b.ts', code: b }], 6).dups).toEqual([]);
  });
});

describe('analyzer — nested templates (styled-components / className builders)', () => {
  it('a nested template in a ${} interpolation is fully collapsed (no leaked code)', () => {
    // a className-builder line with a nested template + control-flow-looking words
    const src = [
      'function cls(active: boolean, color: string) {',
      '  return `btn ${active ? `btn-${color} if for while switch` : ``} done`;',
      '}',
      'function other() { return 1; }',
    ].join('\n');
    const r = analyzeFile('t.ts', src, DEFAULT_QUALITY);
    expect(r.functions.map((f) => f.name)).toContain('other'); // cls must not absorb other
    const c = r.functions.find((f) => f.name === 'cls')!;
    expect(c.cognitive).toBeLessThan(3); // the template's fake if/for/while/switch don't count
    expect(r.longLineNos).toEqual([]); // line is template content, not long code
  });
});
