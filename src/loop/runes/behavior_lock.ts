import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { ToolCall } from '../types.js';
import { sh } from '../../util/exec.js';
import { newSpecs } from './validation_gate.js';

// behavior_lock — the refactor safety net (characterization-first). The existing
// test suite is the contract: snapshot its green result before any edit, forbid
// editing the tests (don't weaken the net), and only allow finishing once the
// source actually changed AND every previously-passing test still passes.
const SPEC_RE = /(\.(test|spec)\.[tj]sx?$)|((^|\/)test_\w+\.py$)|(_test\.py$)/;

export function behaviorLock(): Rune {
  let baselinePassed = 0;
  let baselineTypecheckOk = true;

  return {
    name: 'behavior_lock',

    systemPromptAddition(): string {
      return 'REFACTOR RULES: change the SOURCE only — do not edit, add, or delete any test file (the tests are the behavior contract). Every test that passes now must still pass when you finish, and you must actually change the source. If a test goes red, your refactor changed behavior — fix the source, not the test.';
    },

    async prepare(ctx: RunCtx): Promise<string | undefined> {
      const run = await ctx.adapter.run(ctx.workdir, 'unit');
      baselinePassed = run.passed;
      const tc = await sh(ctx.adapter.commands().typecheck, ctx.workdir);
      baselineTypecheckOk = tc.ok;
      return baselinePassed === 0
        ? 'WARNING: no passing tests found to lock behavior — refactor conservatively; typecheck must stay clean.'
        : `Behavior contract: ${baselinePassed} tests must remain green.`;
    },

    async beforeToolCall(call: ToolCall): Promise<RuneDecision> {
      if ((call.name === 'edit_file' || call.name === 'write_file' || call.name === 'delete_file') &&
        SPEC_RE.test(String((call.input as any).path ?? ''))) {
        return block(
          'behavior_lock: test files are read-only during refactor',
          'You tried to change a test file. During a refactor the tests are the behavior contract — change only source files.',
        );
      }
      return ALLOW;
    },

    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      const sourceEdits = [...ctx.editedFiles].filter((f) => !SPEC_RE.test(f));
      if (sourceEdits.length === 0) {
        return block('behavior_lock: nothing was refactored', 'No source file changed yet. Perform the refactor, then finish.');
      }
      if (baselineTypecheckOk) {
        const tc = await sh(ctx.adapter.commands().typecheck, ctx.workdir);
        if (!tc.ok) return block('behavior_lock: typecheck failed', `Typecheck failed after the refactor:\n${tail(tc.stdout + tc.stderr)}`);
      }
      const run = await ctx.adapter.run(ctx.workdir, 'unit');
      if (!run.green || run.passed < baselinePassed) {
        return block(
          `behavior_lock: behavior changed (${run.passed}/${baselinePassed} tests green)`,
          `The refactor broke ${baselinePassed - run.passed} test(s) — behavior must be preserved. Fix the source so all ${baselinePassed} pass again:\n${tail(run.raw)}`,
        );
      }
      return ALLOW;
    },
  };
}

function tail(s: string, n = 2500): string {
  return s.length > n ? s.slice(-n) : s;
}
