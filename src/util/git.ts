import { execFile } from 'node:child_process';

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
