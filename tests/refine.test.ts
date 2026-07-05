import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { flakeVerdict } from '../src/loop/runes/flake_gate.js';
import { assertionGate } from '../src/loop/runes/assertion_gate.js';
import { validateConfig } from '../src/util/config.js';
import { RunCtx } from '../src/loop/ctx.js';

describe('flakeVerdict', () => {
  it('stable runs → not flaky', () => {
    expect(flakeVerdict(['1/0', '1/0', '1/0'], 0)).toBe(false);
  });
  it('one outlier → flaky at tolerance 0, ok at tolerance 1', () => {
    expect(flakeVerdict(['1/0', '2/0', '1/0'], 0)).toBe(true);
    expect(flakeVerdict(['1/0', '2/0', '1/0'], 1)).toBe(false);
  });
  it('two outliers exceed tolerance 1', () => {
    expect(flakeVerdict(['1/0', '2/0', '3/0'], 1)).toBe(true);
  });
});

describe('validateConfig', () => {
  it('passes a clean config', () => {
    expect(validateConfig({ model: 'auto', minTests: 5, quality: true, kind: 'unit' })).toEqual([]);
  });
  it('flags unknown keys', () => {
    expect(validateConfig({ maxStep: 10 })[0]).toContain('unknown key "maxStep"');
  });
  it('flags wrong types', () => {
    expect(validateConfig({ minTests: '5' })[0]).toContain('must be number');
  });
  it('flags a bad kind enum', () => {
    expect(validateConfig({ kind: 'integration' }).some((e) => e.includes('kind'))).toBe(true);
  });
});

describe('assertionGate', () => {
  const ctxWith = async (spec: string) => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-ag-'));
    await writeFile(join(dir, 'x.test.ts'), spec);
    const ctx = new RunCtx(dir, {} as any, 't');
    ctx.editedFiles.add('x.test.ts');
    return ctx;
  };

  it('blocks a weak suite (toBeDefined only) below the floor', async () => {
    const ctx = await ctxWith('it("x", () => { expect(foo()).toBeDefined(); });');
    const d = await assertionGate(80).shouldStop!(ctx);
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.inject).toContain('toBeDefined');
  });

  it('allows a strong suite (concrete values)', async () => {
    const ctx = await ctxWith('it("x", () => { expect(add(1,2)).toBe(3); expect(sum([1,2])).toEqual(3); });');
    expect((await assertionGate(80).shouldStop!(ctx)).kind).toBe('allow');
  });

  it('allows when no specs were edited', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-ag-'));
    const ctx = new RunCtx(dir, {} as any, 't');
    expect((await assertionGate(80).shouldStop!(ctx)).kind).toBe('allow');
  });
});
