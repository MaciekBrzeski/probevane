import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { ToolCall } from '../types.js';
import { WRITE_TOOLS } from '../tools.js';

// plan_first — ported from runestone plan_first rune. Blocks write_file/edit_file
// until the `plan` tool has been called. Forces the model to ground its test
// plan (which targets, what behaviors, expected assertions) before generating.
export const planFirst: Rune = {
  name: 'plan_first',

  systemPromptAddition(): string {
    return [
      'PLANNING DISCIPLINE: You MUST call the `plan` tool exactly once before any',
      'write_file or edit_file. The plan must name the target(s), the behaviors to',
      'cover, and the concrete assertions each test will make. Writing a test file',
      'before planning is blocked.',
    ].join(' ');
  },

  async beforeToolCall(call: ToolCall, ctx: RunCtx): Promise<RuneDecision> {
    if (WRITE_TOOLS.has(call.name) && !ctx.plan) {
      return block(
        'plan_first: write attempted before plan',
        'You must call the `plan` tool first, describing targets, behaviors, and the assertions each test will make. Then write the test files.',
      );
    }
    return ALLOW;
  },
};
