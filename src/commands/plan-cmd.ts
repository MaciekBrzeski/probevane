import { formatPlan } from './plan/build.js';
import { gatherPlan } from '../spec-run/gather.js';
import type { TestKind } from '../adapters/adapter.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane plan` backend — read-only action plan ($0, no LLM): untested
// targets + coverage gaps + quality errors + MFE errors → prioritized to-do.
// Moved verbatim from the old shell. (File named plan-cmd.ts: plan/ is the
// backend dir the handler itself imports from.)

/** Print (or --json) the prioritized plan for ctx.dir. */
export async function run(ctx: CommandCtx): Promise<void> {
  const kind = (ctx.flags.kind ?? 'unit') as TestKind;
  const { adapterId, plan, mfe } = await gatherPlan(ctx.dir, kind);
  if (ctx.flags.json === true) {
    console.log(JSON.stringify({ dir: ctx.dir, adapter: adapterId, ...plan }, null, 2));
    return;
  }
  console.log(`[probevane] plan for ${ctx.dir} (adapter ${adapterId}${mfe ? ', Module Federation' : ''})\n`);
  console.log(formatPlan(plan));
  console.log(`\n[probevane] ${plan.summary}`);
}
