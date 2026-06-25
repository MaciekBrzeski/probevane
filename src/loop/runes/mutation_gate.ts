import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { mutationScore } from '../mutation.js';

// mutation_gate — does the suite actually CATCH bugs, or just run green? Mutate
// a few operators in the source and require the suite to fail (kill the mutant).
// Advisory unless enforce=true (--mutation), since it re-runs the suite per mutant.
export function mutationGate(opts: { enforce: boolean; minScore?: number; maxMutants?: number }): Rune {
  const minScore = opts.minScore ?? 0.6;
  return {
    name: 'mutation_gate',
    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      if (!opts.enforce) return ALLOW;
      const { total, killed, score } = await mutationScore(ctx.workdir, ctx.adapter, opts.maxMutants ?? 5);
      const pct = Math.round(score * 100);
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
