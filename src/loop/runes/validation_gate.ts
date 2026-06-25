import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { RunScope } from '../../adapters/adapter.js';
import { sh } from '../../util/exec.js';

// validation_gate — ported from runestone validation_gate.rs. The run can NOT
// finish while: typecheck fails, OR the test suite is red, OR no test was
// actually added, OR the suite is all-skipped (the qaforge `all-skipped`
// anti-pattern promoted to a hard gate). Block => loop continues with feedback.
// Scope-aware: a unit run validates the unit suite; an e2e run the e2e suite.
export function validationGate(scope: RunScope = 'unit', full = false): Rune {
  // Captured once before any edits: did the project typecheck cleanly to begin
  // with? If not (common in big real apps with their own build setup), we don't
  // block on typecheck — a pre-existing failure isn't ours to fix; we rely on
  // the test suite being green instead.
  let baselineTypecheckOk = true;

  return {
    name: 'validation_gate',

    systemPromptAddition(): string {
      return 'FINISH RULE: You may only stop once typecheck passes (if the project was clean to begin with) AND the new tests run green (no failures, not all-skipped). If a gate reports failure, fix it and continue.';
    },

    async prepare(ctx: RunCtx): Promise<string | undefined> {
      const tc = await sh(ctx.adapter.commands().typecheck, ctx.workdir);
      baselineTypecheckOk = tc.ok;
      return baselineTypecheckOk
        ? undefined
        : 'NOTE: the project does not typecheck cleanly on its own; the typecheck gate is relaxed — focus on writing green tests.';
    },

    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      if (ctx.editedFiles.size === 0) {
        return block(
          'validation_gate: no test file was written',
          'You stopped without writing any test. Plan, then write at least one real test, then finish.',
        );
      }

      const cmds = ctx.adapter.commands();
      if (baselineTypecheckOk) {
        const tc = await sh(cmds.typecheck, ctx.workdir);
        if (!tc.ok) {
          return block(
            'validation_gate: typecheck failed',
            `Typecheck (\`${cmds.typecheck}\`) failed:\n${tail(tc.stdout + tc.stderr)}`,
          );
        }
      }

      // Scope to the specs we wrote — a real app's pre-existing suite may be
      // red under our config and is not ours to fix (no_regression forbids
      // touching it). We validate the tests we added. (full=true → whole suite,
      // used by the repair path which must leave everything green.)
      const ours = full ? [] : newSpecs(ctx);
      const run = await ctx.adapter.run(ctx.workdir, scope, ours.length ? ours : undefined);
      ctx.validatedSinceEdit = true;
      if (!run.green) {
        return block(
          `validation_gate: ${scope} tests not green`,
          `The ${scope} tests are not green (passed=${run.passed} failed=${run.failed} skipped=${run.skipped}). Fix them:\n${tail(run.raw)}`,
        );
      }
      return ALLOW;
    },
  };
}

function tail(s: string, n = 2500): string {
  return s.length > n ? s.slice(-n) : s;
}

const SPEC_RE = /(\.(test|spec)\.[tj]sx?$)|((^|\/)test_\w+\.py$)|(_test\.py$)/;
export function newSpecs(ctx: RunCtx): string[] {
  return [...ctx.editedFiles].filter((f) => SPEC_RE.test(f));
}
