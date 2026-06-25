import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Rune } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { CAVEATS_PATH } from '../../library/caveats.js';

// caveat_harvest — ported from runestone's caveat_harvest rune. On stop, the
// distinct gate-block reasons hit this run are appended to a shared caveats file
// (deduped). context_inject feeds recent caveats back into future runs, so the
// loop learns from its own friction (fourier "institutional memory").
export const caveatHarvest: Rune = {
  name: 'caveat_harvest',

  async onStop(ctx: RunCtx): Promise<void> {
    if (ctx.gateBlockReasons.length === 0) return;
    await mkdir(dirname(CAVEATS_PATH), { recursive: true }).catch(() => {});
    const existing = await readFile(CAVEATS_PATH, 'utf8').catch(() => '');
    const fresh = ctx.gateBlockReasons
      .map((r) => `- [${ctx.adapter.id}] ${r}`)
      .filter((line) => !existing.includes(line));
    if (fresh.length) await appendFile(CAVEATS_PATH, fresh.join('\n') + '\n').catch(() => {});
  },
};
