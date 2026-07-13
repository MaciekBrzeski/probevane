import { buildChain } from '../mock/index.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane mock` backend — build the module graph, synthesize the mock
// boundary (network → MSW handlers, dep mocks, prop fixtures), materialize
// shared fixtures + output contracts. Moved verbatim from the old shell.

/** Synthesize and report the mock boundary for ctx.dir. */
export async function run(ctx: CommandCtx): Promise<void> {
  const plan = await buildChain(ctx.dir);
  console.log(
    `[probevane] graph: ${plan.graph.order.length} modules; ${plan.handlers.length} endpoint(s); ` +
      `${Object.keys(plan.fixtures ?? {}).length} fixture(s); ${Object.keys(plan.outputs ?? {}).length} contract(s)`,
  );
  console.log('\n' + plan.digest);
}
