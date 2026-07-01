import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { sitesIn, runMutation } from '../src/loop/mutation.js';
import type { StackAdapter } from '../src/adapters/adapter.js';

describe('mutation sitesIn (literal-aware site detection)', () => {
  it('finds real operators but skips those in strings/comments', () => {
    const src = [
      'export function f(a: number, b: number) {',
      '  const s = "a === b + c";  // x === y',
      '  return a === b && a + 1;',
      '}',
    ].join('\n');
    const sites = sitesIn('src/f.ts', src);
    const ops = sites.map((s) => `${s.op}@${s.line}`).sort();
    // line 3 has real === , && , + ; the string/comment === and + on line 2 are skipped
    expect(ops).toContain('===@3');
    expect(ops).toContain('&&@3');
    expect(ops).toContain('+@3');
    expect(sites.some((s) => s.line === 2)).toBe(false); // nothing mutated in the string/comment line
    expect(sites[0].index).toBeGreaterThan(0); // real char offset carried
  });
});

describe('mutation runMutation', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  // Fake adapter: the "suite" is green iff src/x.ts still contains the original `===`.
  // So the ===→!== mutant makes it red → killed; other ops survive.
  const adapter = {
    async run(d: string) {
      const c = readFileSync(join(d, 'src/x.ts'), 'utf8');
      return { green: c.includes('a === b'), passed: 1, failed: 0, raw: '' };
    },
    async discover() {
      return [{ kind: 'unit', sourcePath: 'src/x.ts', name: 'x' }];
    },
  } as unknown as StackAdapter;

  it('classifies killed vs survived per site + reports byFile and score', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pv-mut-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'x.ts'), 'export const g = (a: number, b: number) => a === b && a + 1;\n');

    const r = await runMutation(dir, adapter, { budget: 50 });
    expect(r.total).toBeGreaterThanOrEqual(3); // ===, &&, +
    expect(r.killed).toBeGreaterThanOrEqual(1); // the === flip is caught
    expect(r.survivors.some((s) => s.op === '&&' || s.op === '+')).toBe(true); // those survive
    expect(r.byFile['src/x.ts'].total).toBe(r.total);
    expect(r.score).toBeCloseTo(r.killed / r.total);
  });

  it('respects the budget (samples) and the glue exclude', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pv-mut2-'));
    mkdirSync(join(dir, 'src', 'cli'), { recursive: true });
    writeFileSync(join(dir, 'src', 'x.ts'), 'export const g = (a: number, b: number) => a === b;\n');
    writeFileSync(join(dir, 'src', 'cli', 'main.ts'), 'export const h = (a: number) => a === 1;\n'); // glue → excluded
    const r = await runMutation(dir, adapter, { budget: 50 });
    expect(Object.keys(r.byFile)).not.toContain('src/cli/main.ts'); // glue skipped by default
    expect(Object.keys(r.byFile)).toContain('src/x.ts');
  });
});
