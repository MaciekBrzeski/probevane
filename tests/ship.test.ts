import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { branchName, prTitle, prBody, type ShipInfo } from '../src/commands/ship/pr.js';
import { shipRun } from '../src/commands/ship/ship.js';

const info = (over: Partial<ShipInfo> = {}): ShipInfo => ({
  op: 'generate',
  repo: 'apps/cart',
  runId: 'run-abc123',
  files: ['src/Cart.test.tsx'],
  tests: 12,
  coverage: 87,
  cost: 0.14,
  ...over,
});

describe('pr builders (pure)', () => {
  it('branchName is namespaced + sanitized, never the default branch', () => {
    expect(branchName('run-abc')).toBe('probevane/run-abc');
    expect(branchName('weird id!@#')).toBe('probevane/weird-id-');
  });
  it('prTitle names op + file count + repo', () => {
    expect(prTitle(info())).toBe('probevane(generate): 1 file(s) in cart');
  });
  it('prBody lists files + stats + a no-merge note', () => {
    const b = prBody(info());
    expect(b).toContain('12 tests');
    expect(b).toContain('cov 87%');
    expect(b).toContain('`src/Cart.test.tsx`');
    expect(b).toContain('does not merge');
  });

  it('branchName falls back to "run" for an empty id and keeps ./_- and slashes', () => {
    expect(branchName('')).toBe('probevane/run');
    expect(branchName('op/refactor_v1.2-x')).toBe('probevane/op/refactor_v1.2-x');
  });

  it('branchName collapses consecutive forbidden chars into a single dash', () => {
    expect(branchName('run  ~~ #42')).toBe('probevane/run-42');
    expect(branchName('a!!!b???c')).toBe('probevane/a-b-c');
  });

  it('prTitle handles zero files and a repo without slashes', () => {
    expect(prTitle(info({ files: [], repo: 'solo' }))).toBe('probevane(generate): 0 file(s) in solo');
  });

  it('prTitle keeps weird chars in op verbatim (no sanitizing of display text)', () => {
    expect(prTitle(info({ op: 'fix <weird> & chars' }))).toContain('probevane(fix <weird> & chars):');
  });

  it('prBody with no edited files still carries the Files header and run id', () => {
    const b = prBody(info({ files: [] }));
    expect(b).toContain('Files:');
    expect(b).toContain('run-abc123');
    expect(b).not.toContain('- `'); // no file bullets
  });

  it('prBody omits the Result line when tests/coverage/cost are all absent', () => {
    const b = prBody(info({ tests: undefined, coverage: undefined, cost: undefined }));
    expect(b).not.toContain('Result:');
    expect(b).toContain('all gates green');
  });

  it('prBody treats null coverage as absent but keeps other stats', () => {
    const b = prBody(info({ coverage: null, cost: undefined }));
    expect(b).toContain('Result: 12 tests');
    expect(b).not.toContain('cov');
  });

  it('prBody includes zero-valued stats (0 tests, cov 0%, $0.0000) rather than dropping them', () => {
    const b = prBody(info({ tests: 0, coverage: 0, cost: 0 }));
    expect(b).toContain('0 tests');
    expect(b).toContain('cov 0%'); // 0 != null → kept
    expect(b).toContain('$0.0000');
  });

  it('prBody formats cost to 4 decimal places', () => {
    expect(prBody(info({ cost: 1.23456 }))).toContain('$1.2346');
  });
});

describe('shipRun (git smoke, no remote → local branch)', () => {
  it('branches off HEAD and commits only the run files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-ship-'));
    const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
    git('init');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    await writeFile(join(dir, 'base.ts'), 'export const x = 1;\n');
    git('add', '.');
    git('commit', '-m', 'base');
    // a run "edited" a new file (uncommitted)
    await writeFile(join(dir, 'src.test.ts'), 'test("x", () => {});\n');

    const r = await shipRun(dir, { runId: 'run-xyz', editedFiles: ['src.test.ts'] }, { op: 'generate', repo: 'demo' });
    expect(r.shipped).toBe(true);
    expect(r.branch).toBe('probevane/run-xyz');
    // on the new branch, the file is committed
    const branch = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    expect(branch).toBe('probevane/run-xyz');
    const tracked = execFileSync('git', ['-C', dir, 'ls-files']).toString();
    expect(tracked).toContain('src.test.ts');
  });

  it('skips cleanly when there are no edited files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-ship-'));
    execFileSync('git', ['-C', dir, 'init'], { stdio: 'ignore' });
    const r = await shipRun(dir, { runId: 'r', editedFiles: [] }, { op: 'generate', repo: 'd' });
    expect(r.shipped).toBe(false);
    expect(r.reason).toContain('no edited files');
  });

  it('skips when not a git repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-ship-'));
    const r = await shipRun(dir, { runId: 'r', editedFiles: ['a.ts'] }, { op: 'generate', repo: 'd' });
    expect(r.shipped).toBe(false);
  });
});
