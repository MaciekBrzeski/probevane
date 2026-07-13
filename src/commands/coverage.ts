import { selectAdapterOrThrow } from '../adapters/registry.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane coverage` backend — run the adapter's coverage command and print
// the four percentages. Moved verbatim from the old src/cli/coverage.ts shell.

/** Report coverage for ctx.dir; exit 1 when the adapter can't measure it. */
export async function run(ctx: CommandCtx): Promise<void> {
  const adapter = await selectAdapterOrThrow(ctx.dir);
  const c = await adapter.coverage(ctx.dir);
  if (!c.ok) {
    console.error('[probevane] coverage unavailable');
    console.error((c.raw ?? '').slice(-1500));
    process.exit(1);
  }
  console.log(
    `[probevane] coverage statements=${c.statements}% branches=${c.branches}% functions=${c.functions}% lines=${c.lines}%`,
  );
}
