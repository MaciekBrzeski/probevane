import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isGitRepo, revertEdits } from '../util/git.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane revert` backend — undo a run's edits. Reads the run's diary
// record (<dir>/.probevane/diary/<runId>.json) for its checkpoint sha + edited
// files; restores each file to the checkpoint (or removes it if the run
// created it). The safety net for a crashed / bad run. Logic moved verbatim
// from the old src/cli/revert.ts shell (own catch: `[revert] error:` prefix +
// e.message, unlike the standard String(e)); the vane interpreter owns argv.

/** What a diary record stores: the run id, its pre-run checkpoint, the files it touched. */
interface DiaryRecord {
  runId?: string;
  checkpointSha?: string;
  editedFiles?: string[];
}

/** Load ctx.args.runId's diary record and restore each edited file to the
 *  checkpoint sha (created files are removed). Requires git — no repo, no undo. */
export async function run(ctx: CommandCtx): Promise<void> {
  try {
    const runId = ctx.args.runId;
    if (!runId) {
      console.error('usage: probevane revert <runId> [dir]');
      process.exit(2);
    }
    const dir = ctx.dir;
    const diaryPath = join(dir, '.probevane', 'diary', `${runId}.json`);
    const rec: DiaryRecord = await readFile(diaryPath, 'utf8').then(JSON.parse).catch(() => ({}));
    const files = rec.editedFiles ?? [];
    if (!files.length) {
      console.log(`[revert] no edited files recorded for ${runId} (nothing to undo).`);
      return;
    }
    if (!(await isGitRepo(dir))) {
      console.error('[revert] not a git repo — cannot restore. Remove unwanted files manually.');
      process.exit(1);
    }
    const sha = rec.checkpointSha || '';
    const { restored, removed } = await revertEdits(dir, sha, files);
    console.log(`[revert] ${runId}: restored ${restored}, removed ${removed} (checkpoint ${sha.slice(0, 8) || 'n/a'}).`);
  } catch (e) {
    console.error('[revert] error:', (e as Error).message);
    process.exit(1);
  }
}
