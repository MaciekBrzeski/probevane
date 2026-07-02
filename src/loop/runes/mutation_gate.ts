import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { mutationScore } from '../mutation.js';

// mutation_gate — does the suite actually CATCH bugs, or just run green? Mutate
// a few operators in the source and require the suite to fail (kill the mutant).
// Advisory unless enforce=true (--strict / --mutation), since it re-runs the suite
// per mutant. This is the ONE correctness gate — the default gates only measure
// well-formedness (KB: "filter measures well-formedness, not correctness").
//
// Default minScore 0.5 (not 0.6): equivalent/glue mutants give a real ~97% ceiling,
// so a higher floor risks false-blocking legitimately-untestable operators. 0.5
// still catches the "asserts nothing" case. Budget-truncated runs are advisory.
export function mutationGate(opts: {
  enforce: boolean;
  minScore?: number;
  maxMutants?: number;
  budgetMs?: number;
}): Rune {
  const minScore = opts.minScore ?? 0.5;
  const budgetMs = opts.budgetMs ?? 90_000;
  return {
    name: 'mutation_gate',
    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      if (!opts.enforce) return ALLOW;
      // Scope to the source the run just tested (edited test files → their source);
      // mutationScore falls back to all targets if nothing matches.
      const scope = [...ctx.editedFiles];
      const { total, killed, score, budgetHit } = await mutationScore(
        ctx.workdir, ctx.adapter, opts.maxMutants ?? 5, 3, { budgetMs, scope },
      );
      const pct = Math.round(score * 100);
      // Never false-block on a budget-truncated (incomplete) measurement.
      if (budgetHit) {
        // No silent cap: surface that the correctness floor was NOT fully measured.
        console.error(`[mutation_gate] budget ${budgetMs}ms exceeded — advisory-skip (${killed}/${total} killed so far)`);
        return ALLOW;
      }
      if (total > 0 && score < minScore) {
        return block(
          `mutation_gate: mutation score ${pct}% < ${Math.round(minScore * 100)}%`,
          `The suite only caught ${killed}/${total} injected bugs (${pct}%). Add assertions that pin the actual computed values / branches so mutations are detected.`,
        );
      }
      return ALLOW;
    },
  };
}
