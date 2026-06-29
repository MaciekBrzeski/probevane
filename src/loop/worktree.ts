import { existsSync, symlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  repoRoot, headSha, addWorktree, removeWorktree, diffStat, commitFiles, mergeBranch, currentBranch,
} from '../util/git.js';
import type { RunOutcome } from './engine.js';
import { getDiff, findingsMarkdown, type Finding } from '../review/diff-review.js';

// `--worktree` isolation: run a path loop in a throwaway git worktree on its own
// branch, so the live working tree is never touched until an explicit review +
// merge. Safer for self-improvement (probevane refactoring its own loop). On
// accept the run's edited files are committed on the branch (kept for review, or
// merged with --worktree-merge); on reject the worktree + branch are discarded.

let seq = 0;

/** Every node_modules dir under `root` (repo-relative), without descending into them. */
function findNodeModules(root: string, sub = '', depth = 0): string[] {
  if (depth > 6) return [];
  const out: string[] = [];
  let entries;
  try { entries = readdirSync(join(root, sub), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === '.git' || e.name === 'dist') continue;
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.name === 'node_modules') { out.push(rel); continue; } // symlink it; don't descend
    out.push(...findNodeModules(root, rel, depth + 1));
  }
  return out;
}

export interface WorktreeOpts {
  merge?: boolean; // auto-merge the branch into the original branch on accept
  review?: (diff: string) => Promise<Finding[]>; // self-review the accepted diff before keep/merge
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
    // A fresh worktree has no node_modules (gitignored) → symlink EVERY node_modules
    // dir from the source tree (root + nested, e.g. fixtures/*/node_modules) so
    // tsc/vitest resolve everywhere — not just hoisted root deps.
    for (const rel of findNodeModules(root)) {
      const src = join(root, rel);
      const dst = join(wt, rel);
      if (existsSync(dst)) continue;
      try { mkdirSync(dirname(dst), { recursive: true }); symlinkSync(src, dst, 'dir'); } catch { /* best-effort */ }
    }

    const outcome = await run(join(wt, rel));

    if (!outcome.accepted) {
      log(`[probevane] worktree: not accepted (${outcome.stopReason}) — discarding (live tree clean)`);
      await removeWorktree(root, wt, branch);
      return outcome;
    }

    // ACCEPTED. Commit ONLY the loop's edited files (prefixed by the run subdir) —
    // never `git add -A`, which would capture the node_modules symlink / fixtures.
    const files = outcome.editedFiles.map((f) => (rel ? join(rel, f) : f));
    await commitFiles(wt, files, `probevane ${label}: ${files.length} file(s) (gates green)`);
    const stat = await diffStat(wt, 'HEAD~1'); // the committed change (incl. new files)

    // Self-review the committed diff before keep-vs-merge (the gates prove the suite
    // is green; this catches behavior/quality smells a green suite misses). Reviewing
    // the COMMIT (vs HEAD~1) — not the working tree — so new files are included.
    let doMerge = opts.merge;
    if (opts.review) {
      const findings = await opts.review(await getDiff(wt, 'HEAD~1')).catch(() => [] as Finding[]);
      const errs = findings.filter((f) => f.severity === 'error');
      const head = `[probevane] worktree review — ${findings.length} finding(s), ${errs.length} error`;
      log(findings.length ? `${head}:\n${findingsMarkdown(findings)}` : '[probevane] worktree review: clean');
      if (doMerge && errs.length) {
        doMerge = false; // don't auto-merge over review errors — keep the branch for a human
        log(`[probevane] worktree: ${errs.length} review error(s) — auto-merge BLOCKED; keeping branch ${branch}`);
      }
    }

    if (doMerge) {
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
