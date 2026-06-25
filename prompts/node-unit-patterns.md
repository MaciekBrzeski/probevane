# Unit patterns — vitest (plain TS/JS)

Place the test next to its source: `src/<name>.test.ts`. Always import explicitly.

## PATTERN N1 — pure function
```ts
import { describe, it, expect } from 'vitest';
import { capOutput } from './exec';

describe('capOutput', () => {
  it('returns input unchanged when short', () => {
    expect(capOutput('a\nb', 40, 60)).toBe('a\nb');
  });
  it('elides the middle of long input', () => {
    const out = capOutput(Array.from({ length: 200 }, (_, i) => `L${i}`).join('\n'), 5, 5);
    expect(out).toContain('elided');
    expect(out.split('\n').length).toBeLessThan(20);
  });
});
```

## PATTERN N2 — error path
```ts
it('throws on bad input', () => {
  expect(() => parse('')).toThrow();
});
```

## PATTERN N3 — table-driven
```ts
it.each([
  [0, true],
  [3, false],
])('isEven(%i) === %s', (n, expected) => {
  expect(isEven(n)).toBe(expected);
});
```

## Rules
- `import { describe, it, expect } from 'vitest'` — never rely on globals.
- Assert concrete values (`toBe`, `toEqual`), not just truthiness.
- Cover edge cases (empty, boundary) and every error path.
- Import only names listed in the ground truth.
