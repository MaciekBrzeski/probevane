import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { newSpecs } from './validation_gate.js';

// flake_gate — the run can't finish if the new tests are non-deterministic. Run
// them N times; if the pass/fail signature varies, they're flaky (uncontrolled
// time/random/order/async). Opt-in (slow). `tolerance` allows up to K outlier
// runs (default 0 = identical every time).

/** Flaky if more than `tolerance` runs disagree with the most common signature. */
export function flakeVerdict(sigs: string[], tolerance = 0): boolean {
  const counts = new Map<string, number>();
  for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1);
  const mode = Math.max(0, ...counts.values());
  return sigs.length - mode > tolerance;
}

export function flakeGate(runs = 3, tolerance = 0): Rune {
  return {
    name: 'flake_gate',

    systemPromptAddition(): string {
      return 'DETERMINISM: the new tests must pass identically every run. No uncontrolled time/random/order; await async work; the flake gate runs them several times and rejects non-determinism.';
    },

    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      const specs = newSpecs(ctx);
      const scope = 'unit';
      const sigs: string[] = [];
      for (let i = 0; i < runs; i++) {
        const r = await ctx.adapter.run(ctx.workdir, scope, specs.length ? specs : undefined);
        sigs.push(`${r.passed}/${r.failed}`);
      }
      if (flakeVerdict(sigs, tolerance)) {
        return block(
          `flake_gate: non-deterministic tests (${sigs.join(' → ')})`,
          `The new tests gave different results across ${runs} runs (${sigs.join(', ')})${tolerance ? ` beyond the ${tolerance}-run tolerance` : ''}. Remove the non-determinism: fake timers / fixed seeds, await all async work, no test-order dependence.`,
        );
      }
      return ALLOW;
    },
  };
}
