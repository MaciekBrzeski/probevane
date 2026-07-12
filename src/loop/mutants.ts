// Shared mutation vocabulary — the operator table + result/survivor types +
// tiny pure helpers, split out of mutation.ts (which holds the run machinery).

// Mutate a few source operators and check the suite fails (kills the mutant).
// Used by mutation_gate (enforce) and bench (report).
export const MUTATIONS: [RegExp, string][] = [
  [/===/g, '!=='],
  [/!==/g, '==='],
  [/>=/g, '<'],
  [/<=/g, '>'],
  [/&&/g, '||'],
  [/\btrue\b/g, 'false'],
  [/\+/g, '-'],
];

/** Aggregate mutation verdict (killed/total) — what mutation_gate scores and bench reports. */
export interface MutationResult {
  total: number;
  killed: number;
  score: number; // killed/total (1 if none applicable)
  budgetHit?: boolean; // true if the wall-budget cut the run short (partial score)
}

/** A mutant the current suite does NOT catch — the actionable signal for
 *  mutation-driven generation: write a test that fails when this is applied. */
export interface SurvivingMutant {
  sourcePath: string;
  line: number;
  mutation: string; // "=== \u2192 !=="
  snippet: string; // the source line, trimmed
}

/** 1-based line number of a character index in `src`. */
export function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length;
}

/** Prompt block steering generation at the surviving mutants. */
export function mutantDigest(survivors: SurvivingMutant[]): string {
  if (!survivors.length) return '';
  return (
    'SURVIVING MUTANTS \u2014 the current tests do NOT catch these. Add a test that FAILS when each mutation is applied (assert the exact behavior the mutation breaks):\n' +
    survivors.map((m) => `- ${m.sourcePath}:${m.line}  \`${m.mutation}\`  in: ${m.snippet}`).join('\n')
  );
}
