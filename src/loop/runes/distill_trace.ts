import type { Rune } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { recordTrace } from '../../distill/collect.js';

// distill_trace — on an ACCEPTED run, record the (context → accepted spec) pair
// as a distillation trace. No-op unless PROBEVANE_TRACES=1, so it's free to
// leave in every profile. The harness teaches a local model from its own wins.
export const distillTrace: Rune = {
  name: 'distill_trace',
  async onStop(ctx: RunCtx): Promise<void> {
    if (!ctx.accepted || process.env.PROBEVANE_TRACES !== '1') return;
    await recordTrace(ctx, new Date().toISOString()).catch(() => {});
  },
};
