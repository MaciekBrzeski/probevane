import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { qualityGate } from '../src/loop/runes/quality_gate.js';
import { RunCtx } from '../src/loop/ctx.js';

const ctxFor = async (files: Record<string, string>, edited: string[]) => {
  const dir = await mkdtemp(join(tmpdir(), 'pv-qg-'));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  const ctx = new RunCtx(dir, {} as any, 'task');
  edited.forEach((f) => ctx.editedFiles.add(f));
  return ctx; // checkpointSha '' → no git baseline → absolute check (before = 0)
};

describe('qualityGate', () => {
  const tiny = { maxFileLoc: 10, maxFnLoc: 5 };

  it('allows when no source files were edited', async () => {
    const ctx = await ctxFor({ 'a.test.ts': 'x\n'.repeat(50) }, ['a.test.ts']);
    const d = await qualityGate(tiny).shouldStop!(ctx);
    expect(d.kind).toBe('allow');
  });

  it('blocks when an edited source file is over the bar (no baseline)', async () => {
    const ctx = await ctxFor({ 'big.ts': 'const x = 1;\n'.repeat(40) }, ['big.ts']);
    const d = await qualityGate(tiny).shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.reason).toContain('quality_gate');
      expect(d.inject).toContain('file-size');
    }
  });

  it('allows a clean small edited file', async () => {
    const ctx = await ctxFor({ 'ok.ts': 'export const add = (a, b) => a + b;\n' }, ['ok.ts']);
    const d = await qualityGate(tiny).shouldStop!(ctx);
    expect(d.kind).toBe('allow');
  });

  it('ignores edited test files (audit_gate owns those)', async () => {
    const ctx = await ctxFor({ 'big.spec.ts': 'const x = 1;\n'.repeat(40) }, ['big.spec.ts']);
    const d = await qualityGate(tiny).shouldStop!(ctx);
    expect(d.kind).toBe('allow');
  });

  it('exposes a system-prompt addition naming the thresholds', () => {
    const txt = qualityGate({ maxFileLoc: 222 }).systemPromptAddition!();
    expect(txt).toContain('222');
  });
});

describe('qualityGate (baseline-aware via git checkpoint)', () => {
  const tiny = { maxFileLoc: 10, maxFnLoc: 5 };

  const setup = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-qgg-'));
    const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
    git('init');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    // baseline: ALREADY over the bar (15 lines, limit 10)
    await writeFile(join(dir, 'big.ts'), 'const x = 1;\n'.repeat(15));
    git('add', 'big.ts');
    git('commit', '-m', 'base');
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
    return { dir, sha };
  };

  const decide = async (dir: string, sha: string) => {
    const ctx = new RunCtx(dir, {} as any, 't');
    ctx.checkpointSha = sha;
    ctx.editedFiles.add('big.ts');
    return qualityGate(tiny).shouldStop!(ctx);
  };

  it('allows when an already-over-bar file is unchanged in size', async () => {
    const { dir, sha } = await setup();
    await writeFile(join(dir, 'big.ts'), 'const y = 2;\n'.repeat(15)); // same size, edited
    expect((await decide(dir, sha)).kind).toBe('allow');
  });

  it('blocks when an edit makes the file worse than baseline', async () => {
    const { dir, sha } = await setup();
    await writeFile(join(dir, 'big.ts'), 'const y = 2;\n'.repeat(40));
    expect((await decide(dir, sha)).kind).toBe('block');
  });

  it('allows when an edit improves (shrinks) the file', async () => {
    const { dir, sha } = await setup();
    await writeFile(join(dir, 'big.ts'), 'const y = 2;\n'.repeat(8));
    expect((await decide(dir, sha)).kind).toBe('allow');
  });
});
