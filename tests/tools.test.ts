import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execTool } from '../src/loop/tools.js';
import { RunCtx } from '../src/loop/ctx.js';
import { nullAdapter } from '../src/adapters/null-adapter.js';

// Workspace-scoped reads: a sandboxed run (workdir = one package) may READ sibling
// workspace packages, but WRITES stay confined to the workdir. The security
// boundary: reads widen to the workspace/repo root (excl. .git, no absolute);
// writes/edits/deletes never escape the workdir.

const call = (name: string, input: object) => ({ id: 't', name, input }) as never;
const ctx = (workdir: string) => new RunCtx(workdir, nullAdapter, 'task');

describe('tools — workspace-scoped reads, confined writes', () => {
  let ws: string; // workspace root (has package.json with "workspaces")
  let work: string; // workdir = a package under the workspace
  beforeAll(() => {
    ws = mkdtempSync(join(tmpdir(), 'pv-ws-'));
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*', 'pkg'] }));
    mkdirSync(join(ws, 'packages', 'x', 'src'), { recursive: true });
    writeFileSync(join(ws, 'packages', 'x', 'src', 'a.ts'), 'export const A = 1;\n');
    work = join(ws, 'pkg');
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, 'own.ts'), 'export const OWN = 1;\n');
  });
  afterAll(() => rmSync(ws, { recursive: true, force: true }));

  it('read_file reaches a sibling workspace package', async () => {
    const out = await execTool(call('read_file', { path: '../packages/x/src/a.ts' }), ctx(work));
    expect(out).toContain('export const A = 1');
  });

  it('list_dir reaches a sibling workspace package', async () => {
    const out = await execTool(call('list_dir', { path: '../packages/x/src' }), ctx(work));
    expect(out).toContain('a.ts');
  });

  it('read_file inside the workdir still works', async () => {
    expect(await execTool(call('read_file', { path: 'own.ts' }), ctx(work))).toContain('OWN');
  });

  it('read_file rejects absolute paths', async () => {
    await expect(execTool(call('read_file', { path: '/etc/hostname' }), ctx(work))).rejects.toThrow(/absolute/);
  });

  it('read_file rejects a path above the workspace root', async () => {
    await expect(execTool(call('read_file', { path: '../../../../../../etc/passwd' }), ctx(work))).rejects.toThrow(/outside the workspace/);
  });

  it('write_file CANNOT escape the workdir (writes stay confined)', async () => {
    await expect(execTool(call('write_file', { path: '../packages/x/src/evil.ts', contents: 'x' }), ctx(work))).rejects.toThrow(/escapes project dir/);
  });

  it('edit_file CANNOT escape the workdir', async () => {
    await expect(execTool(call('edit_file', { path: '../packages/x/src/a.ts', old_string: 'A', new_string: 'B' }), ctx(work))).rejects.toThrow(/escapes project dir/);
  });

  it('reads increment ctx.reads', async () => {
    const c = ctx(work);
    await execTool(call('read_file', { path: 'own.ts' }), c);
    await execTool(call('list_dir', { path: '.' }), c);
    expect(c.reads).toBe(2);
  });
});

describe('tools — non-workspace dir falls back to workdir-confined reads', () => {
  let plain: string; // no package.json/.git/pnpm markers
  let work: string;
  beforeAll(() => {
    plain = mkdtempSync(join(tmpdir(), 'pv-plain-'));
    writeFileSync(join(plain, 'sibling.ts'), 'secret\n');
    work = join(plain, 'app');
    mkdirSync(work, { recursive: true });
  });
  afterAll(() => rmSync(plain, { recursive: true, force: true }));

  it('read_file cannot escape the workdir when there is no workspace/repo root', async () => {
    await expect(execTool(call('read_file', { path: '../sibling.ts' }), ctx(work))).rejects.toThrow(/outside the workspace/);
  });
});
