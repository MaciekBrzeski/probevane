import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateRunSpec, specToLaunchPlan, specToArgv, isDarkRunnable, saveSpec, loadSpec, type RunSpec,
} from './runspec.js';

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  id: 'x1', prompt: 'add tests', path: 'write_tests', dir: '/repo', kind: 'unit',
  acceptance: { minTests: 3, minCoverage: 80 }, model: 'ollama', budget: 40000, maxSteps: 30,
  decompose: { perFile: true }, ...over,
});

describe('validateRunSpec', () => {
  it('accepts a well-formed spec', () => {
    expect(validateRunSpec(spec())).toEqual([]);
  });
  it('rejects a bad path, missing dir, bad kind, non-number budget', () => {
    const errs = validateRunSpec({ ...spec(), path: 'nope', dir: '', kind: 'x', budget: '9' } as unknown);
    expect(errs.some((e) => e.includes('path'))).toBe(true);
    expect(errs.some((e) => e.includes('dir'))).toBe(true);
    expect(errs.some((e) => e.includes('kind'))).toBe(true);
    expect(errs.some((e) => e.includes('budget'))).toBe(true);
  });
  it('rejects a non-object', () => {
    expect(validateRunSpec(null)).toEqual(['spec must be an object']);
  });
  it('accepts a valid oracle, rejects a malformed one', () => {
    expect(validateRunSpec(spec({ oracle: { kind: 'golden', desc: 'locked snapshot' } }))).toEqual([]);
    const errs = validateRunSpec(spec({ oracle: { kind: 'nope', desc: 'x' } as never }));
    expect(errs.some((e) => e.includes('oracle.kind'))).toBe(true);
  });
});

describe('specToLaunchPlan', () => {
  it('serializes a write_tests spec to a scoped generate with floors', () => {
    const p = specToLaunchPlan(spec({ only: 'src/a.ts', targetGaps: true }));
    expect(p.op).toBe('generate');
    expect(p.flags).toEqual([
      '--kind', 'unit', '--only', 'src/a.ts', '--max-targets', '1', '--target-gaps',
      '--min-tests', '3', '--min-coverage', '80', '--model', 'ollama', '--budget', '40000', '--max-steps', '30',
    ]);
  });
  it('serializes a task path with --task and no --kind', () => {
    const p = specToLaunchPlan(spec({ path: 'refactor', task: 'extract helpers', acceptance: {} }));
    expect(p.op).toBe('refactor');
    expect(p.flags).toContain('--task');
    expect(p.flags).toContain('extract helpers');
    expect(p.flags).not.toContain('--kind');
  });
  it('emits --strict and --takeover when set', () => {
    const p = specToLaunchPlan(spec({ strict: true, takeover: 'sonnet' }));
    expect(p.flags).toContain('--strict');
    expect(p.flags).toEqual(expect.arrayContaining(['--takeover', 'sonnet']));
  });
});

describe('isDarkRunnable', () => {
  it('is true for generate-backed paths, false for document/migrate (not in the launch allowlist)', () => {
    expect(isDarkRunnable(spec())).toBe(true);
    expect(isDarkRunnable(spec({ path: 'document' }))).toBe(false);
    expect(isDarkRunnable(spec({ path: 'migrate' }))).toBe(false);
  });
});

describe('specToArgv', () => {
  it('prepends op + resolved dir', () => {
    const argv = specToArgv(spec());
    expect(argv[0]).toBe('generate');
    expect(argv[1]).toMatch(/repo$/);
  });
});

describe('saveSpec / loadSpec', () => {
  it('round-trips a spec through <root>/specs/<id>.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'probevane-spec-'));
    const path = await saveSpec(spec({ id: 'rt1' }), root);
    expect(path).toMatch(/specs\/rt1\.json$/);
    const back = await loadSpec('rt1', root);
    expect(back).toEqual(spec({ id: 'rt1' }));
  });
});
