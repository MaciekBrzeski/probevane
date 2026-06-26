import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isGitRepo, revertEdits } from '../util/git.js';

// probevane revert <runId> [dir] — undo a run's edits. Reads the run's diary
// record (<dir>/.probevane/diary/<runId>.json) for its checkpoint sha + edited
// files; restores each file to the checkpoint (or removes it if the run created
// it). The safety net for a crashed / bad run.

interface DiaryRecord {
  runId?: string;
  checkpointSha?: string;
  editedFiles?: string[];
}

async function main() {
  const [runId, dirArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!runId) {
    console.error('usage: probevane revert <runId> [dir]');
    process.exit(2);
  }
  const dir = resolve(dirArg ?? '.');
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
}

main().catch((e) => { console.error('[revert] error:', e.message); process.exit(1); });
