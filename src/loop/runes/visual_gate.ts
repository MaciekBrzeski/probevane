import { join, dirname } from 'node:path';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { newSpecs } from './validation_gate.js';

// visual_gate — opt-in (--visual, e2e). Each generated e2e spec must capture a
// visual-regression checkpoint (toHaveScreenshot / checkpoint()). prepare()
// drops the checkpoint helper into the project's e2e/ so specs can import it.
const VISUAL = /toHaveScreenshot|checkpoint\s*\(/;

export const visualGate: Rune = {
  name: 'visual_gate',

  async prepare(ctx: RunCtx): Promise<string | undefined> {
    const dst = join(ctx.workdir, 'e2e', 'checkpoint.ts');
    const srcHelper = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'e2e', 'checkpoint.ts');
    await mkdir(dirname(dst), { recursive: true }).catch(() => {});
    await copyFile(srcHelper, dst).catch(() => {});
    return undefined;
  },

  systemPromptAddition(): string {
    return "VISUAL REGRESSION: each e2e spec MUST capture a visual checkpoint — `import { checkpoint } from './checkpoint'` then `await checkpoint(page, '<state-name>')` at each key UI state (mask dynamic regions). A spec with no screenshot assertion is rejected.";
  },

  async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
    for (const rel of newSpecs(ctx)) {
      if (rel.endsWith('checkpoint.ts')) continue; // the helper itself
      const src = await readFile(join(ctx.workdir, rel), 'utf8').catch(() => '');
      if (!src) continue;
      if (!VISUAL.test(src)) {
        return block(
          `visual_gate: ${rel} has no visual checkpoint`,
          `${rel} drives the UI but never captures a screenshot. Add \`await checkpoint(page, '<name>')\` (or expect(page).toHaveScreenshot) at each key state, then finish.`,
        );
      }
    }
    return ALLOW;
  },
};
