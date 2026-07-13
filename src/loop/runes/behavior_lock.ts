import type { Rune, RuneDecision } from '../rune.js';
import { tail } from '../../util/text.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { ToolCall } from '../types.js';
import { sh } from '../../util/exec.js';

// behavior_lock — the refactor safety net (characterization-first). The existing
// test suite is the contract: snapshot its green result before any edit, forbid
// editing the tests (don't weaken the net), and only allow finishing once the
// source actually changed AND every previously-passing test still passes.
const SPEC_RE = /(\.(test|spec)\.[tj]sx?$)|((^|\/)test_\w+\.py$)|(_test\.py$)/;

interface BehaviorState {
  baselinePassed: number;
  baselineTypecheckOk: boolean;
}

const BEHAVIOR_SYSTEM_PROMPT =
  'REFACTOR RULES: change the SOURCE only — do not edit, add, or delete any test file (the tests are the behavior contract). Every test that passes now must still pass when you finish, and you must actually change the source. If a test goes red, your refactor changed behavior — fix the source, not the test.';

/** Snapshot the contract before any edit: passing-test count + typecheck state.
 *  Zero passing tests → warn (nothing to lock) instead of pretending safety. */
async function behaviorPrepare(ctx: RunCtx, state: BehaviorState): Promise<string | undefined> {
  const run = await ctx.adapter.run(ctx.workdir, 'unit');
  state.baselinePassed = run.passed;
  const tc = await sh(ctx.adapter.commands(ctx.workdir).typecheck, ctx.workdir);
  state.baselineTypecheckOk = tc.ok;
  return state.baselinePassed === 0
    ? 'WARNING: no passing tests found to lock behavior — refactor conservatively; typecheck must stay clean.'
    : `Behavior contract: ${state.baselinePassed} tests must remain green.`;
}

/** Veto any write/delete touching a test file — the contract must not be weakened mid-refactor. */
async function behaviorBeforeToolCall(call: ToolCall): Promise<RuneDecision> {
  if ((call.name === 'edit_file' || call.name === 'write_file' || call.name === 'delete_file') &&
    SPEC_RE.test(String((call.input as any).path ?? ''))) {
    return block(
      'behavior_lock: test files are read-only during refactor',
      'You tried to change a test file. During a refactor the tests are the behavior contract — change only source files.',
    );
  }
  return ALLOW;
}

/** Allow finishing only when source actually changed AND typecheck (if it started
 *  clean) + every baseline test are still green. */
async function behaviorShouldStop(ctx: RunCtx, state: BehaviorState): Promise<RuneDecision> {
  const sourceEdits = [...ctx.editedFiles].filter((f) => !SPEC_RE.test(f));
  if (sourceEdits.length === 0) {
    return block('behavior_lock: nothing was refactored', 'No source file changed yet. Perform the refactor, then finish.');
  }
  if (state.baselineTypecheckOk) {
    const tc = await sh(ctx.adapter.commands(ctx.workdir).typecheck, ctx.workdir);
    if (!tc.ok) return block('behavior_lock: typecheck failed', `Typecheck failed after the refactor:\n${tail(tc.stdout + tc.stderr)}`);
  }
  const run = await ctx.adapter.run(ctx.workdir, 'unit');
  if (!run.green || run.passed < state.baselinePassed) {
    return block(
      `behavior_lock: behavior changed (${run.passed}/${state.baselinePassed} tests green)`,
      `The refactor broke ${state.baselinePassed - run.passed} test(s) — behavior must be preserved. Fix the source so all ${state.baselinePassed} pass again:\n${tail(run.raw)}`,
    );
  }
  return ALLOW;
}

/** Build the refactor safety-net rune; per-instance state holds the baseline snapshot. */
export function behaviorLock(): Rune {
  const state: BehaviorState = { baselinePassed: 0, baselineTypecheckOk: true };
  return {
    name: 'behavior_lock',
    systemPromptAddition: () => BEHAVIOR_SYSTEM_PROMPT,
    prepare: (ctx) => behaviorPrepare(ctx, state),
    beforeToolCall: (call) => behaviorBeforeToolCall(call),
    shouldStop: (ctx) => behaviorShouldStop(ctx, state),
  };
}

