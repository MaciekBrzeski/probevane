import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openPr } from '../src/ship/pr.js';

// openPr shells out to `gh` via node:child_process directly (not util/exec.js),
// so this lives in its own file where mocking child_process cannot collide with
// the real git calls in ship.test.ts.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: execFileMock };
});

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

describe('openPr (gh CLI, mocked)', () => {
  // NB: braces matter — mockReset() returns the mock, and a function returned
  // from beforeEach is treated by vitest as a cleanup hook (and gets called).
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('returns ok + the PR url picked from gh stdout', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb: ExecCb) => {
      cb(null, 'Creating pull request...\nhttps://github.com/acme/app/pull/7\n', '');
    });
    const r = await openPr('/tmp/repo', { branch: 'probevane/run-1', title: 't', body: 'b' });
    expect(r).toEqual({ ok: true, url: 'https://github.com/acme/app/pull/7' });
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe('gh');
    expect(args).toEqual(['pr', 'create', '--head', 'probevane/run-1', '--title', 't', '--body', 'b']);
    expect(opts.cwd).toBe('/tmp/repo');
  });

  it('returns ok:false (never throws) when gh fails, still surfacing any url', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb: ExecCb) => {
      cb(new Error('gh: not logged in'), '', '');
    });
    const r = await openPr('/tmp/repo', { branch: 'b', title: 't', body: 'b' });
    expect(r.ok).toBe(false);
    expect(r.url).toBeUndefined();
  });

  it('leaves url undefined when stdout has no http line', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb: ExecCb) => {
      cb(null, 'created (no url printed)\n', '');
    });
    const r = await openPr('/tmp/repo', { branch: 'b', title: 't', body: 'b' });
    expect(r).toEqual({ ok: true, url: undefined });
  });
});
