import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

// Minimal git helpers for the run safety net: capture HEAD before a run edits the
// workdir (checkpoint), and restore the run's touched files afterward (revert).
// No-ops gracefully outside a git repo.

function git(dir: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      resolve({ ok: !err, out: stdout ?? '' }),
    );
  });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).ok;
}

/** Absolute path of the repo root containing `dir` ('' if not a repo). */
export async function repoRoot(dir: string): Promise<string> {
  const r = await git(dir, ['rev-parse', '--show-toplevel']);
  return r.ok ? r.out.trim() : '';
}

/** Create a worktree at `path` on a new `branch` (off HEAD). */
export async function addWorktree(root: string, path: string, branch: string): Promise<boolean> {
  return (await git(root, ['worktree', 'add', path, '-b', branch])).ok;
}

/** Remove a worktree (force) + delete its branch. Best-effort. */
export async function removeWorktree(root: string, path: string, branch?: string): Promise<void> {
  await git(root, ['worktree', 'remove', '--force', path]);
  if (branch) await git(root, ['branch', '-D', branch]);
}

/** `git diff --stat` at `dir` — working tree by default, or against `base` (e.g. HEAD~1). */
export async function diffStat(dir: string, base?: string): Promise<string> {
  return (await git(dir, ['diff', '--stat', ...(base ? [base] : [])])).out.trim();
}

/** Merge `branch` into the current branch at `root` (no-ff). */
export async function mergeBranch(root: string, branch: string, message: string): Promise<boolean> {
  return (await git(root, ['merge', '--no-ff', '-m', message, branch])).ok;
}

/** Current HEAD sha, or '' if not a repo / no commits. */
export async function headSha(dir: string): Promise<string> {
  const r = await git(dir, ['rev-parse', 'HEAD']);
  return r.ok ? r.out.trim() : '';
}

/** Did `file` (project-relative) exist at commit `sha`? */
export async function fileExistedAt(dir: string, sha: string, file: string): Promise<boolean> {
  return (await git(dir, ['cat-file', '-e', `${sha}:${file}`])).ok;
}

/** Restore `file` to its content at `sha`. */
export async function restoreFile(dir: string, sha: string, file: string): Promise<boolean> {
  return (await git(dir, ['checkout', sha, '--', file])).ok;
}

/** Content of `file` at commit `sha`, or '' if it didn't exist / not a repo. */
export async function showFile(dir: string, sha: string, file: string): Promise<string> {
  if (!sha) return '';
  const r = await git(dir, ['show', `${sha}:${file}`]);
  return r.ok ? r.out : '';
}

// --- ship helpers (Pillar A) — deliver an accepted run as a branch/commit/PR ---

/** Current branch name (e.g. 'main'), or '' outside a repo / detached HEAD. */
export async function currentBranch(dir: string): Promise<string> {
  const r = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.out.trim() : '';
}

/** Create + switch to a new branch off HEAD. */
export async function createBranch(dir: string, name: string): Promise<boolean> {
  return (await git(dir, ['checkout', '-b', name])).ok;
}

/** Stage the given files and commit them; returns false if nothing committed. */
export async function commitFiles(dir: string, files: string[], message: string): Promise<boolean> {
  if (!files.length) return false;
  if (!(await git(dir, ['add', '--', ...files])).ok) return false;
  return (await git(dir, ['commit', '-m', message])).ok;
}

/** Push `branch` to origin (sets upstream). False if no remote / push fails. */
export async function push(dir: string, branch: string): Promise<boolean> {
  return (await git(dir, ['push', '-u', 'origin', branch])).ok;
}

/** True if the repo has an `origin` remote (a push target exists). */
export async function hasRemote(dir: string): Promise<boolean> {
  return (await git(dir, ['remote', 'get-url', 'origin'])).ok;
}

/**
 * Undo a run's edits: restore each file to its content at `sha` if it existed
 * then, else remove it (the run created it). The shared core of `revert` and the
 * factory's revert-on-error. Returns how many were restored vs removed.
 */
export async function revertEdits(
  dir: string,
  sha: string,
  files: string[],
): Promise<{ restored: number; removed: number }> {
  let restored = 0,
    removed = 0;
  for (const f of files) {
    if (sha && (await fileExistedAt(dir, sha, f))) {
      if (await restoreFile(dir, sha, f)) restored++;
    } else {
      await rm(join(dir, f), { force: true });
      removed++;
    }
  }
  return { restored, removed };
}
