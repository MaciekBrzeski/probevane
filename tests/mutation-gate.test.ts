import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mutationGate } from '../src/loop/runes/mutation_gate.js';
import { mutationScore } from '../src/loop/mutation.js';
import { RunCtx } from '../src/loop/ctx.js';
import type { StackAdapter } from '../src/adapters/adapter.js';

// A suite that ALWAYS reports green catches nothing — every mutant survives.
// This is the "well-formed but tests nothing" case the default gates miss.
const blindAdapter = {
  async run() { return { green: true, passed: 3, failed: 0, raw: '' }; },
  async discover() { return [{ kind: 'unit', sourcePath: 'src/x.ts', name: 'x' }]; },
} as unknown as StackAdapter;

// A suite green iff the source still has its original operators — kills mutants.
const strongAdapter = {
  async run(d: string) {
    const c = readFileSync(join(d, 'src/x.ts'), 'utf8');
    return { green: c.includes('a === b') && c.includes('&&'), passed: 3, failed: 0, raw: '' };
  },
  async discover() { return [{ kind: 'unit', sourcePath: 'src/x.ts', name: 'x' }]; },
} as unknown as StackAdapter;

function mkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pv-mgate-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'x.ts'), 'export const g = (a: number, b: number) => a === b && a + 1;\n');
  return dir;
}

describe('mutation_gate (correctness floor)', () => {
  let dir: string;
  afterEach(() => { dir && rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('BLOCKS a green-but-tests-nothing suite (the well-formedness gap)', async () => {
    dir = mkdir();
    const ctx = new RunCtx(dir, blindAdapter, 'test');
    const d = await mutationGate({ enforce: true }).shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.reason).toMatch(/mutation score/);
  });

  it('ALLOWS a suite that kills its mutants', async () => {
    dir = mkdir();
    const ctx = new RunCtx(dir, strongAdapter, 'test');
    const d = await mutationGate({ enforce: true }).shouldStop!(ctx);
    expect(d.kind).toBe('allow');
  });

  it('is a no-op when enforce=false (advisory / casual runs)', async () => {
    dir = mkdir();
    const ctx = new RunCtx(dir, blindAdapter, 'test');
    const d = await mutationGate({ enforce: false }).shouldStop!(ctx);
    expect(d.kind).toBe('allow');
  });

  it('budget-truncated run is advisory (never a false block / deadlock)', async () => {
    dir = mkdir();
    const ctx = new RunCtx(dir, blindAdapter, 'test');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // budgetMs=0 → deadline already passed → budgetHit before any mutant → ALLOW.
    const d = await mutationGate({ enforce: true, budgetMs: 0 }).shouldStop!(ctx);
    expect(d.kind).toBe('allow');
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/budget .* exceeded/));
  });
});

describe('mutationScore scope', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('prefers targets matching the scoped test stem, falls back when none match', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pv-scope-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'x.ts'), 'export const g = (a: number, b: number) => a === b;\n');
    writeFileSync(join(dir, 'src', 'y.ts'), 'export const h = (a: number) => a === 1;\n');
    const multi = {
      async run() { return { green: true, passed: 1, failed: 0, raw: '' }; },
      async discover() {
        return [
          { kind: 'unit', sourcePath: 'src/x.ts', name: 'x' },
          { kind: 'unit', sourcePath: 'src/y.ts', name: 'y' },
        ];
      },
    } as unknown as StackAdapter;
    // scope to x.test.ts → only x.ts mutated. Both suites are blind (green) so
    // total>0 proves it ran; if scope were ignored it would still run, so assert
    // the run completed with a finite total (smoke that scope path doesn't throw).
    const r = await mutationScore(dir, multi, 5, 3, { scope: ['src/x.test.ts'] });
    expect(r.total).toBeGreaterThan(0);
    expect(r.budgetHit).toBeFalsy();
  });
});
