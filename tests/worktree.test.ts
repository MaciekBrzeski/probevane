import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInWorktree } from '../src/loop/worktree.js';
import type { RunOutcome } from '../src/loop/engine.js';

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
    mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true }); // gitignored-style dep dir
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
    g('add', '-A'); g('commit', '-qm', 'init');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('accepts: commits edited files on a branch, removes the worktree, leaves the live tree untouched', async () => {
    const out = await runInWorktree(repo, 'feature', async (wd) => {
      // node_modules must be symlinked into the worktree (the gotcha)
      expect(lstatSync(join(wd, 'node_modules')).isSymbolicLink()).toBe(true);
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

  it('throws on a non-git directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'pv-plain-'));
    await expect(runInWorktree(plain, 'feature', async () => base({}))).rejects.toThrow(/needs a git repo/);
    rmSync(plain, { recursive: true, force: true });
  });
});
