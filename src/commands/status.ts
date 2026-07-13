import { selectAdapter } from '../adapters/registry.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane status` backend — quick dashboard: adapter, unit run, coverage.
// Moved verbatim from the old shell (selectAdapter, NOT OrThrow: a dir with no
// adapter is a normal answer here, not an error).

/** Print the adapter / unit-run / coverage snapshot for ctx.dir. */
export async function run(ctx: CommandCtx): Promise<void> {
  const adapter = await selectAdapter(ctx.dir);
  if (!adapter) {
    console.log('[probevane] no adapter matched this directory');
    return;
  }
  console.log(`adapter:  ${adapter.id}`);
  const r = await adapter.run(ctx.dir, 'unit');
  console.log(`unit:     ${r.green ? 'green' : 'red'} (passed=${r.passed} failed=${r.failed} skipped=${r.skipped})`);
  const c = await adapter.coverage(ctx.dir).catch(() => null);
  if (c?.ok) console.log(`coverage: statements=${c.statements}% lines=${c.lines}%`);
}
