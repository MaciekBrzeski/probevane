// Assertion-quality scorer — static grade of how much a test actually ASSERTS.
// Audit catches assertion-FREE tests; mutation catches missing coverage; this
// catches WEAK assertions that pass without testing behavior:
//   - existence/type only: toBeDefined / toBeTruthy / toBeFalsy / toBeNull / toBeUndefined
//   - tautology: expect(<literal>).toBe(<same literal>)
//   - snapshot-only: toMatchSnapshot / toMatchInlineSnapshot
//   - bare not.toThrow() (asserts "didn't crash", not the result)
// Pure + testable.

export interface WeakAssertion {
  line: number;
  kind: string;
  snippet: string;
}
export interface AssertionScore {
  total: number; // expect() statements seen
  strong: number;
  weak: WeakAssertion[];
  score: number; // 0..100, strong/total
}

// Only toBeDefined/toBeTruthy are weak — they don't pin a value. toBeNull /
// toBeUndefined / toBeFalsy assert a SPECIFIC value (null/undefined/false), so
// they're real assertions (a check fn returning null is correctly tested by toBeNull).
const WEAK = /\.(toBeDefined|toBeTruthy)\s*\(\s*\)/;
const SNAPSHOT = /\.(toMatchSnapshot|toMatchInlineSnapshot)\s*\(/;
const NOTHROW_SOLO = /\.not\s*\.\s*toThrow\s*\(\s*\)/;
const STRONG = /\.(toBe|toEqual|toStrictEqual|toContain|toContainEqual|toMatch|toMatchObject|toHaveLength|toBeCloseTo|toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual|toHaveBeenCalledWith|toHaveBeenNthCalledWith|toHaveProperty|toThrowError|toThrow)\s*\(\s*\S/;
const TAUTOLOGY = /expect\(\s*(true|false|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|`[^`]*`)\s*\)\s*\.\s*(?:toBe|toEqual)\(\s*\1\s*\)/;

/** Grade the assertion strength of a spec file's source. */
export function scoreAssertions(source: string): AssertionScore {
  const weak: WeakAssertion[] = [];
  let total = 0;
  let strong = 0;
  const lines = source.split('\n');
  lines.forEach((l, i) => {
    if (!/\bexpect\s*\(/.test(l)) return;
    total++;
    const ln = i + 1;
    const snip = l.trim().slice(0, 90);
    if (TAUTOLOGY.test(l)) weak.push({ line: ln, kind: 'tautology', snippet: snip });
    else if (NOTHROW_SOLO.test(l)) weak.push({ line: ln, kind: 'bare not.toThrow', snippet: snip });
    else if (SNAPSHOT.test(l) && !STRONG.test(l)) weak.push({ line: ln, kind: 'snapshot-only', snippet: snip });
    else if (WEAK.test(l) && !STRONG.test(l)) weak.push({ line: ln, kind: 'existence/type-only', snippet: snip });
    else strong++;
  });
  return { total, strong, weak, score: total ? Math.round((strong / total) * 100) : 0 };
}

/** Roll several files' scores into one. */
export function aggregateScore(
  perFile: Array<{ file: string; s: AssertionScore }>,
): { score: number; total: number; weak: number } {
  const total = perFile.reduce((n, x) => n + x.s.total, 0);
  const strong = perFile.reduce((n, x) => n + x.s.strong, 0);
  const weak = perFile.reduce((n, x) => n + x.s.weak.length, 0);
  return { score: total ? Math.round((strong / total) * 100) : 0, total, weak };
}
