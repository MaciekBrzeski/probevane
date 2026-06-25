import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';

// mutation_gate — does the suite actually CATCH bugs, or just run green? We
// mutate a few operators in the source under test and require the suite to fail
// (kill the mutant). Mutation score = killed / total. Advisory by default
// (logs); enforces only when constructed with enforce=true (--mutation), since
// it re-runs the suite per mutant and is slow.
const MUTATIONS: [RegExp, string][] = [
  [/===/g, '!=='],
  [/!==/g, '==='],
  [/>=/g, '<'],
  [/<=/g, '>'],
  [/&&/g, '||'],
  [/\btrue\b/g, 'false'],
  [/\+/g, '-'],
];

export function mutationGate(opts: { enforce: boolean; minScore?: number; maxMutants?: number }): Rune {
  const minScore = opts.minScore ?? 0.6;
  const maxMutants = opts.maxMutants ?? 5;

  return {
    name: 'mutation_gate',

    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      if (!opts.enforce) return ALLOW; // purely opt-in (--mutation); slow, re-runs suite per mutant
      // Runs after validation_gate, so the suite is already green here.
      const targets = (await ctx.adapter.discover(ctx.workdir, 'unit')).slice(0, 3);
      let total = 0;
      let killed = 0;

      for (const t of targets) {
        const abs = join(ctx.workdir, t.sourcePath);
        const original = await readFile(abs, 'utf8').catch(() => '');
        if (!original) continue;

        for (const [re, repl] of MUTATIONS) {
          if (total >= maxMutants) break;
          if (!re.test(original)) continue;
          const mutated = original.replace(re, repl); // mutate first occurrence class
          if (mutated === original) continue;
          total++;
          try {
            await writeFile(abs, mutated);
            const run = await ctx.adapter.run(ctx.workdir, 'unit');
            if (!run.green) killed++; // suite caught the mutant
          } finally {
            await writeFile(abs, original); // always restore
          }
        }
      }

      const score = total ? killed / total : 1;
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
