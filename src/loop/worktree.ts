import { existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  repoRoot, headSha, addWorktree, removeWorktree, diffStat, commitFiles, mergeBranch, currentBranch,
} from '../util/git.js';
import type { RunOutcome } from './engine.js';

// `--worktree` isolation: run a path loop in a throwaway git worktree on its own
// branch, so the live working tree is never touched until an explicit review +
// merge. Safer for self-improvement (probevane refactoring its own loop). On
// accept the run's edited files are committed on the branch (kept for review, or
// merged with --worktree-merge); on reject the worktree + branch are discarded.

let seq = 0;

export interface WorktreeOpts {
  merge?: boolean; // auto-merge the branch into the original branch on accept
  log?: (l: string) => void;
}

/** Run `run(workdir)` inside an isolated git worktree of `dir`'s repo. */
export async function runInWorktree(
  dir: string,
  label: string,
  run: (workdir: string) => Promise<RunOutcome>,
  opts: WorktreeOpts = {},
): Promise<RunOutcome> {
  const log = opts.log ?? (() => {});
  const root = await repoRoot(dir);
  if (!root || !(await headSha(root))) throw new Error('--worktree needs a git repo with at least one commit');
  const rel = relative(root, dir); // subdir to run in ('' when dir is the repo root)
  const onBranch = (await currentBranch(root)) || 'HEAD';
  const id = `${process.pid}-${++seq}`;
  const branch = `probevane/${label}-${id}`;
  const wt = join(tmpdir(), `probevane-wt-${label}-${id}`);

  if (!(await addWorktree(root, wt, branch))) throw new Error(`failed to create git worktree at ${wt}`);
  log(`[probevane] worktree ${wt} (branch ${branch}) — live tree untouched`);

  try {
    // A fresh worktree has no node_modules (gitignored) → symlink the repo root's
    // so tsc/vitest resolve. Root-hoisted only; per-package node_modules unhandled.
    const rootNM = join(root, 'node_modules');
    const wtNM = join(wt, 'node_modules');
    if (existsSync(rootNM) && !existsSync(wtNM)) { try { symlinkSync(rootNM, wtNM, 'dir'); } catch { /* best-effort */ } }

    const outcome = await run(join(wt, rel));

    if (!outcome.accepted) {
      log(`[probevane] worktree: not accepted (${outcome.stopReason}) — discarding worktree + branch (live tree clean)`);
      await removeWorktree(root, wt, branch);
      return outcome;
    }

    // ACCEPTED. Commit ONLY the loop's edited files (prefixed by the run subdir) —
    // never `git add -A`, which would capture the node_modules symlink / fixtures.
    const stat = await diffStat(wt);
    const files = outcome.editedFiles.map((f) => (rel ? join(rel, f) : f));
    await commitFiles(wt, files, `probevane ${label}: ${files.length} file(s) (gates green)`);

    if (opts.merge) {
      const ok = await mergeBranch(root, branch, `merge ${branch} (probevane ${label}, gates green)`);
      await removeWorktree(root, wt, branch);
      log(ok
        ? `[probevane] worktree: merged ${branch} into ${onBranch}, cleaned up`
        : `[probevane] worktree: MERGE FAILED (conflict?) — branch ${branch} kept; resolve manually`);
    } else {
      // Keep the branch for review; remove only the worktree directory.
      await removeWorktree(root, wt);
      log(`[probevane] worktree: changes committed on ${branch} (live tree untouched)`);
      log(`[probevane]   review:  git -C ${root} diff ${onBranch}..${branch}`);
      log(`[probevane]   merge:   git -C ${root} merge ${branch}`);
    }
    if (stat) log(`[probevane] worktree diff:\n${stat}`);
    return outcome;
  } catch (e) {
    await removeWorktree(root, wt, branch).catch(() => {});
    throw e;
  }
}
