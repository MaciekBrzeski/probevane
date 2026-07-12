// Property/invariant testing — dep-free (plain vitest, no fast-check). For PURE
// functions, asserting INVARIANTS over a spread of inputs beats hard-coded
// input→output examples: it covers the input space AND doesn't require computing
// exact expected values — which is exactly where a small local model fails
// (it binds facts via fact-RAG but guesses computed values). Invariants sidestep
// that: assert the RELATION, not the magic number.

export function propertyGuidance(): string {
  return [
    'PROPERTY / INVARIANT TESTING (prefer for pure functions): alongside a few',
    'concrete examples, assert INVARIANTS over a spread of inputs — they cover more',
    'and need no exact expected value (do NOT guess computed numbers):',
    '- round-trip / inverse: f(g(x)) === x  (parse∘format, encode∘decode)',
    '- idempotence: f(f(x)) === f(x)',
    '- range / format: the result always matches a shape or stays in bounds',
    '  (e.g. expect(formatPrice(c)).toMatch(/^\\$-?\\d+\\.\\d{2}$/))',
    '- relational: commutative, monotonic, length-preserving, sum-equals-parts',
    '  (e.g. cartTotal of a subset ≤ cartTotal of the whole)',
    '- edge spread: it.each([empty, zero, negative, large, duplicates]) — assert the',
    '  invariant holds for each, not a per-input magic number',
    'Use plain vitest (it.each / a loop). No extra library.',
  ].join('\n');
}

const IMPURE = /\b(fetch\s*\(|axios|readFile|writeFile|child_process|Date\.now|Math\.random|new Date)/;
// Pure = no IO/network/clock/random + has plain function exports. Property tests
// only make sense (and are safe) for these.
export function looksPropertyTestable(source: string): boolean {
  return /export\s+(?:async\s+)?function\s+\w+|export\s+const\s+\w+\s*=\s*\(/.test(source) && !IMPURE.test(source);
}
