import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Rune } from '../rune.js';
import type { RunCtx } from '../ctx.js';

// session_diary — ported from runestone's session_diary rune. On stop, write a
// per-run record (metrics + outcome) under <workdir>/.probevane/diary/. Gives
// overwatch of every run without coupling to the eval harness.
export const sessionDiary: Rune = {
  name: 'session_diary',

  async onStop(ctx: RunCtx): Promise<void> {
    const dir = join(ctx.workdir, '.probevane', 'diary');
    await mkdir(dir, { recursive: true }).catch(() => {});
    const record = {
      task: ctx.task.slice(0, 200),
      accepted: ctx.accepted,
      stopReason: ctx.stopReason,
      steps: ctx.step,
      toolCalls: ctx.toolCalls,
      gateBlocks: ctx.gateBlocks,
      gateBlockReasons: ctx.gateBlockReasons,
      editedFiles: [...ctx.editedFiles],
      hadPlan: !!ctx.plan,
    };
    // Key on the unique runId — no cross-run collision (was a module-static counter).
    const name = `${ctx.runId || `run-${ctx.step}`}.json`;
    await writeFile(join(dir, name), JSON.stringify(record, null, 2) + '\n').catch(() => {});
  },
};
