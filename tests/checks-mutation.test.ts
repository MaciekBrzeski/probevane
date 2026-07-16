import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectChecks } from '../src/server/checks.js';

// The Checks tab surfaces heavy gates from artifacts, never runs them live.
// This pins the mutation-report.json round-trip: present → populated + typed,
// absent → null (absence is never a pass).

/** Minimal scannable project + optional mutation artifact. */
function mkProject(artifact?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'pv-checks-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), '/** doc */\nexport const a = 1;\n');
  if (artifact) {
    mkdirSync(join(dir, '.probevane'), { recursive: true });
    writeFileSync(join(dir, '.probevane', 'mutation-report.json'), JSON.stringify(artifact));
  }
  return dir;
}

describe('collectChecks — mutation artifact', () => {
  it('reads a present mutation-report.json into the report', async () => {
    const dir = mkProject({ score: 0.64, killed: 32, survived: 18, total: 50, sampled: true, at: '2026-07-16T10:00:00.000Z' });
    const r = await collectChecks(dir);
    expect(r.mutation).toEqual({ score: 0.64, survived: 18, total: 50, sampled: true, at: '2026-07-16T10:00:00.000Z' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('is null when no artifact exists (absence is not a pass)', async () => {
    const dir = mkProject();
    const r = await collectChecks(dir);
    expect(r.mutation).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is null on a corrupt artifact rather than throwing', async () => {
    const dir = mkProject();
    mkdirSync(join(dir, '.probevane'), { recursive: true });
    writeFileSync(join(dir, '.probevane', 'mutation-report.json'), '{ not json');
    const r = await collectChecks(dir);
    expect(r.mutation).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
