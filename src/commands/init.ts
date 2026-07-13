import { selectAdapterOrThrow } from '../adapters/registry.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane init` backend — detect stack + install test deps/config
// (idempotent). Moved verbatim from the old shell; vane owns argv.

/** Detect the stack for ctx.dir and run the adapter's installer. */
export async function run(ctx: CommandCtx): Promise<void> {
  const adapter = await selectAdapterOrThrow(ctx.dir);
  console.error(`[probevane] detected adapter=${adapter.id} dir=${ctx.dir}`);
  await adapter.install(ctx.dir);
  console.log(`[probevane] init complete — ${adapter.id} ready in ${ctx.dir}`);
}
