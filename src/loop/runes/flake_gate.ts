import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { newSpecs } from './validation_gate.js';

// flake_gate — the run can't finish if the new tests are non-deterministic. Run
// them N times; if the pass/fail signature differs across runs, they're flaky
// (uncontrolled time/random/order/async). Opt-in (slow): runs the suite N×.
export function flakeGate(runs = 3): Rune {
  return {
    name: 'flake_gate',

    systemPromptAddition(): string {
      return 'DETERMINISM: the new tests must pass identically every run. No uncontrolled time/random/order; await async work; the flake gate runs them several times and rejects any non-determinism.';
    },

    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      const specs = newSpecs(ctx);
      const scope = 'unit';
      const sigs: string[] = [];
      for (let i = 0; i < runs; i++) {
        const r = await ctx.adapter.run(ctx.workdir, scope, specs.length ? specs : undefined);
        sigs.push(`${r.passed}/${r.failed}`);
      }
      const first = sigs[0];
      if (sigs.some((s) => s !== first)) {
        return block(
          `flake_gate: non-deterministic tests (${sigs.join(' → ')})`,
          `The new tests gave different results across ${runs} runs (${sigs.join(', ')}). Remove the non-determinism: use fake timers / fixed seeds, await all async work, and don't depend on test order.`,
        );
      }
      return ALLOW;
    },
  };
}
