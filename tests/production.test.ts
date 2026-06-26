import { describe, it, expect } from 'vitest';
import { appendFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { stateRoot, statePath } from '../src/util/state.js';
import { appendJsonl, readJsonl } from '../src/util/jsonl.js';
import { Limiter } from '../src/brain/limiter.js';
import { isGitRepo, headSha, fileExistedAt, restoreFile } from '../src/util/git.js';

// ---- Phase 1: state isolation -----------------------------------------------
describe('stateRoot', () => {
  it('honors PROBEVANE_STATE for isolation', () => {
    const old = process.env.PROBEVANE_STATE;
    process.env.PROBEVANE_STATE = '/tmp/pv-iso';
    try {
      expect(stateRoot()).toBe('/tmp/pv-iso');
      expect(statePath('traces', 'traces.jsonl')).toBe('/tmp/pv-iso/traces/traces.jsonl');
    } finally {
      if (old === undefined) delete process.env.PROBEVANE_STATE; else process.env.PROBEVANE_STATE = old;
    }
  });
  it('defaults under home when unset', () => {
    const old = process.env.PROBEVANE_STATE;
    delete process.env.PROBEVANE_STATE;
    try {
      expect(stateRoot()).toMatch(/\.local[/\\]share[/\\]probevane$/);
    } finally {
      if (old !== undefined) process.env.PROBEVANE_STATE = old;
    }
  });
});

// ---- Phase 1: atomic JSONL --------------------------------------------------
describe('appendJsonl', () => {
  it('serializes concurrent appends — no torn or lost lines', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'pv-jsonl-')), 'x.jsonl');
    await Promise.all(Array.from({ length: 50 }, (_, i) => appendJsonl(p, { i, pad: 'x'.repeat(300) })));
    const rows = await readJsonl<{ i: number }>(p);
    expect(rows).toHaveLength(50);
    expect(new Set(rows.map((r) => r.i)).size).toBe(50);
  });
  it('readJsonl skips a malformed line (torn-write defense)', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'pv-jsonl-')), 'y.jsonl');
    await appendJsonl(p, { a: 1 });
    await appendFile(p, '{ not valid json\n');
    await appendJsonl(p, { a: 2 });
    expect((await readJsonl<{ a: number }>(p)).map((r) => r.a)).toEqual([1, 2]);
  });
});

// ---- Phase 1: rate-limit ----------------------------------------------------
describe('Limiter', () => {
  it('never exceeds max in-flight', async () => {
    const lim = new Limiter(2);
    let active = 0, peak = 0;
    await Promise.all(Array.from({ length: 8 }, () => lim.run(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    })));
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2); // actually parallel up to the cap
  });
});

// ---- Phase 1: git safety net ------------------------------------------------
describe('git revert helpers', () => {
  function gitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pv-git-'));
    const g = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    g(['init', '-q']);
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n');
    g(['add', '-A']); g(['commit', '-qm', 'init']);
    return dir;
  }
  it('captures HEAD, detects file presence, restores a modified file', async () => {
    const dir = gitRepo();
    expect(await isGitRepo(dir)).toBe(true);
    const sha = await headSha(dir);
    expect(sha).toMatch(/^[0-9a-f]{7,}/);
    expect(await fileExistedAt(dir, sha, 'a.ts')).toBe(true);
    expect(await fileExistedAt(dir, sha, 'new.ts')).toBe(false);
    writeFileSync(join(dir, 'a.ts'), 'CORRUPTED\n'); // simulate a bad run edit
    expect(await restoreFile(dir, sha, 'a.ts')).toBe(true);
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('export const x = 1;\n');
  });
  it('isGitRepo is false outside a repo', async () => {
    expect(await isGitRepo(mkdtempSync(join(tmpdir(), 'pv-nogit-')))).toBe(false);
  });
});
