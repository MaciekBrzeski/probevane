import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { ToolCall, ToolResult } from '../types.js';

// red_first — TDD discipline for the feature path. The model must write a NEW
// test that FAILS against the current code BEFORE it may touch source. A spec
// that's already green proves nothing; one that goes red→green proves the test
// drives the feature. After that, source edits unlock and the spec must end green.
const SPEC_RE = /(\.(test|spec)\.[tj]sx?$)|((^|\/)test_\w+\.py$)|(_test\.py$)/;

const isSpec = (c: ToolCall) => SPEC_RE.test(String((c.input as any).path ?? ''));

interface RedState {
  redConfirmed: boolean; // a freshly-written spec has been observed failing
}

const RED_SYSTEM_PROMPT =
  'TDD (red-first): FIRST write a new test that specifies the feature and FAILS against the current code — you may not edit any source file until a new test is failing. Then implement the feature in source until that test passes. Do not weaken the test to make it pass.';

async function redBeforeToolCall(call: ToolCall, state: RedState): Promise<RuneDecision> {
  const writing = call.name === 'write_file' || call.name === 'edit_file' || call.name === 'delete_file';
  if (writing && !isSpec(call) && !state.redConfirmed) {
    return block(
      'red_first: source edit before a failing test',
      'Write a NEW test that specifies the feature and fails first. Only after a test is red may you edit source.',
    );
  }
  return ALLOW;
}

async function redAfterToolCall(call: ToolCall, result: ToolResult, ctx: RunCtx, state: RedState): Promise<void> {
  // When a spec is (re)written and source hasn't been confirmed red yet, run
  // just that spec — if it fails, the red phase is satisfied.
  if (state.redConfirmed || result.isError) return;
  if ((call.name === 'write_file' || call.name === 'edit_file') && isSpec(call)) {
    const path = String((call.input as any).path ?? '');
    const run = await ctx.adapter.run(ctx.workdir, 'unit', [path]).catch(() => null);
    if (run && !run.green) state.redConfirmed = true;
  }
}

async function redShouldStop(state: RedState): Promise<RuneDecision> {
  if (!state.redConfirmed) {
    return block(
      'red_first: no failing test was written first',
      'You must add a NEW test that failed against the original code (red) and now passes (green). The current run never observed a red test — write a real specifying test.',
    );
  }
  return ALLOW;
}

export function redFirst(): Rune {
  const state: RedState = { redConfirmed: false };
  return {
    name: 'red_first',
    systemPromptAddition: () => RED_SYSTEM_PROMPT,
    beforeToolCall: (call) => redBeforeToolCall(call, state),
    afterToolCall: (call, result, ctx) => redAfterToolCall(call, result, ctx, state),
    shouldStop: () => redShouldStop(state),
  };
}
