import { describe, it, expect } from 'vitest';
import { detectPythonFunctions } from './py-detect.js';

// These shell out to python3; if none is present detectPythonFunctions returns null and
// the assertions are skipped (the analyzer degrades gracefully rather than failing).

describe('detectPythonFunctions', () => {
  it('measures params + nesting-weighted complexity from Python source', async () => {
    const src = [
      'def f(a, b, c):',
      '    for x in a:', // +1 branch, nesting 1
      '        if x and b:', // +1 (if) +1 (and), nesting 2
      '            return x',
      '    return b',
    ].join('\n');
    const m = await detectPythonFunctions([{ file: 'f.py', source: src }]);
    if (m === null) return;
    const fns = m.get('f.py')!;
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe('f');
    expect(fns[0]!.params).toBe(3);
    expect(fns[0]!.nesting).toBeGreaterThanOrEqual(2);
    expect(fns[0]!.complexity).toBeGreaterThan(1); // for + if + and → branches + 1
    expect(fns[0]!.cognitive).toBeGreaterThanOrEqual(4); // deep branches cost more
  });

  it('measures nested functions on their own, not folded into the parent', async () => {
    const src = 'def outer():\n    def inner():\n        if 1:\n            return 2\n    return inner';
    const m = await detectPythonFunctions([{ file: 'x.py', source: src }]);
    if (m === null) return;
    const byName = Object.fromEntries(m.get('x.py')!.map((f) => [f.name, f]));
    expect(Object.keys(byName).sort()).toEqual(['inner', 'outer']);
    expect(byName.inner!.complexity).toBeGreaterThan(byName.outer!.complexity); // inner has the `if`
  });

  it('counts *args / **kwargs / keyword-only in params', async () => {
    const m = await detectPythonFunctions([
      { file: 'p.py', source: 'def g(a, b, *rest, key=1, **kw):\n    return a' },
    ]);
    if (m === null) return;
    expect(m.get('p.py')![0]!.params).toBe(5); // a, b, *rest, key, **kw
  });

  it('returns [] for a syntax error instead of throwing', async () => {
    const m = await detectPythonFunctions([{ file: 'bad.py', source: 'def (' }]);
    if (m === null) return;
    expect(m.get('bad.py')).toEqual([]);
  });
});
