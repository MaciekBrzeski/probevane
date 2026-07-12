import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInWorktree } from '../src/loop/worktree.js';
import type { RunOutcome } from '../src/loop/engine/index.js';
import type { Finding } from '../src/review/diff-review.js';

const base = (over: Partial<RunOutcome>): RunOutcome => ({
  accepted: true, steps: 1, toolCalls: 1, gateBlocks: 0, stopReason: 'accepted',
  tokensIn: 0, tokensOut: 0, cacheRead: 0, tookOver: false, editedFiles: [], ...over,
});

describe('runInWorktree', () => {
  let repo: string;
  const g = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pv-wtrepo-'));
    g('init', '-q');
    g('config', 'user.email', 't@t.t'); g('config', 'user.name', 'T');
    g('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), '# repo\n');
    mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true }); // root dep dir
    mkdirSync(join(repo, 'fixtures', 'app', 'node_modules', 'dep'), { recursive: true }); // nested (non-hoisted)
    writeFileSync(join(repo, 'fixtures', 'app', 'index.ts'), 'export const x = 1;\n');
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
    g('add', '-A'); g('commit', '-qm', 'init');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('accepts: commits edited files on a branch, removes the worktree, leaves the live tree untouched', async () => {
    const out = await runInWorktree(repo, 'feature', async (wd) => {
      // node_modules must be symlinked into the worktree (the gotcha) — root AND nested
      expect(lstatSync(join(wd, 'node_modules')).isSymbolicLink()).toBe(true);
      expect(lstatSync(join(wd, 'fixtures', 'app', 'node_modules')).isSymbolicLink()).toBe(true);
      writeFileSync(join(wd, 'newfile.ts'), 'export const X = 1;\n');
      return base({ accepted: true, editedFiles: ['newfile.ts'] });
    });
    expect(out.accepted).toBe(true);
    // live tree NOT modified
    expect(existsSync(join(repo, 'newfile.ts'))).toBe(false);
    // a probevane branch exists carrying the change
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'probevane/*'], { encoding: 'utf8' });
    expect(branches).toMatch(/probevane\/feature-/);
    const br = branches.trim().replace(/^\*?\s*/, '');
    expect(execFileSync('git', ['-C', repo, 'show', `${br}:newfile.ts`], { encoding: 'utf8' })).toContain('export const X');
  });

  it('rejects: discards the worktree + branch, live tree untouched', async () => {
    const out = await runInWorktree(repo, 'refactor', async (wd) => {
      writeFileSync(join(wd, 'tmp.ts'), 'nope\n');
      return base({ accepted: false, stopReason: 'stuck', editedFiles: ['tmp.ts'] });
    });
    expect(out.accepted).toBe(false);
    expect(existsSync(join(repo, 'tmp.ts'))).toBe(false);
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'probevane/*'], { encoding: 'utf8' });
    expect(branches.trim()).toBe(''); // branch deleted
  });

  it('merge mode: merges the branch into the current branch on accept', async () => {
    const out = await runInWorktree(repo, 'fix', async (wd) => {
      writeFileSync(join(wd, 'merged.ts'), 'export const M = 1;\n');
      return base({ accepted: true, editedFiles: ['merged.ts'] });
    }, { merge: true });
    expect(out.accepted).toBe(true);
    // now ON the live tree after merge
    expect(existsSync(join(repo, 'merged.ts'))).toBe(true);
  });

  it('review gate blocks auto-merge on error findings (keeps branch, live tree clean)', async () => {
    const review = async (diff: string): Promise<Finding[]> => {
      expect(diff).toContain('risky.ts'); // the committed diff (incl. the new file) reaches the reviewer
      return [{ file: 'risky.ts', line: 1, severity: 'error', issue: 'bad', fix: 'dont' }];
    };
    const out = await runInWorktree(repo, 'fix', async (wd) => {
      writeFileSync(join(wd, 'risky.ts'), 'export const R = 1;\n');
      return base({ accepted: true, editedFiles: ['risky.ts'] });
    }, { merge: true, review });
    expect(out.accepted).toBe(true);
    expect(existsSync(join(repo, 'risky.ts'))).toBe(false); // merge BLOCKED by the review error
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'probevane/*'], { encoding: 'utf8' });
    expect(branches).toMatch(/probevane\/fix-/); // branch kept for a human
  });

  it('review with no error findings still merges (nits do not block)', async () => {
    const review = async (): Promise<Finding[]> => [{ file: 'ok.ts', line: 1, severity: 'nit', issue: 'meh', fix: 'maybe' }];
    await runInWorktree(repo, 'fix', async (wd) => {
      writeFileSync(join(wd, 'ok.ts'), 'export const O = 1;\n');
      return base({ accepted: true, editedFiles: ['ok.ts'] });
    }, { merge: true, review });
    expect(existsSync(join(repo, 'ok.ts'))).toBe(true); // merged despite a nit
  });

  it('throws on a non-git directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'pv-plain-'));
    await expect(runInWorktree(plain, 'feature', async () => base({}))).rejects.toThrow(/needs a git repo/);
    rmSync(plain, { recursive: true, force: true });
  });
});
