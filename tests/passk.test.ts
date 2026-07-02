import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectBest, scoreSuite, passKGenerate, type Candidate, type SuiteScore } from '../src/loop/passk.js';
import type { StackAdapter } from '../src/adapters/adapter.js';

const score = (value: number): SuiteScore => ({
  green: value >= 0,
  tests: 0,
  coverage: 0,
  auditScore: 0,
  auditErrors: value < 0 ? 1 : 0,
  value,
});
const cand = (label: string, value: number): Candidate<string> => ({ label, score: score(value), ref: label });

describe('passk.selectBest', () => {
  it('returns null for an empty candidate list', () => {
    expect(selectBest([])).toBeNull();
  });
  it('picks the highest value', () => {
    const best = selectBest([cand('a', 10), cand('b', 30), cand('c', 20)]);
    expect(best?.label).toBe('b');
  });
  it('ties are deterministic: the FIRST of equal-value candidates wins', () => {
    const best = selectBest([cand('first', 5), cand('second', 5), cand('third', 5)]);
    expect(best?.label).toBe('first');
  });
  it('returns null when every candidate is negative (a red suite is worthless)', () => {
    expect(selectBest([cand('a', -1), cand('b', -1)])).toBeNull();
  });
  it('a zero-value candidate still beats all-negative and is selectable', () => {
    const best = selectBest([cand('red', -1), cand('empty', 0)]);
    expect(best?.label).toBe('empty');
  });
});

// --- scoreSuite -------------------------------------------------------------

function specDir(contents = 'expect(sum(1, 2)).toBe(3);\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'pv-passk-'));
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'a.test.ts'), contents);
  return dir;
}

/** In-memory fake adapter — only the four methods scoreSuite touches. */
function fakeAdapter(over: Partial<Record<'run' | 'coverage' | 'specFiles' | 'auditRules', unknown>> = {}): StackAdapter {
  return {
    async run() { return { green: true, passed: 4, failed: 0, skipped: 0, raw: '' }; },
    async coverage() { return { statements: 80, branches: 70, functions: 60, lines: 80, ok: true }; },
    async specFiles() { return ['tests/a.test.ts']; },
    auditRules() { return []; },
    ...over,
  } as unknown as StackAdapter;
}

describe('passk.scoreSuite', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('green + clean audit → value = coverage + 2*tests + 5*auditScore', async () => {
    dir = specDir();
    const s = await scoreSuite(dir, fakeAdapter());
    expect(s.green).toBe(true);
    expect(s.tests).toBe(4);
    expect(s.coverage).toBe(80);
    expect(s.auditScore).toBe(5); // no rules → clean → 5
    expect(s.value).toBe(80 + 4 * 2 + 5 * 5);
  });

  it('a red suite is worthless: value = -1 regardless of coverage', async () => {
    dir = specDir();
    const red = fakeAdapter({ async run() { return { green: false, passed: 0, failed: 2, skipped: 0, raw: '' }; } });
    const s = await scoreSuite(dir, red);
    expect(s.green).toBe(false);
    expect(s.value).toBe(-1);
  });

  it('an audit ERROR also zeroes the candidate (value = -1)', async () => {
    dir = specDir('await page.waitForTimeout(5000);\n');
    const strict = fakeAdapter({
      auditRules() {
        return [{ id: 'no-sleep', severity: 'error', check: (l: string) => (l.includes('waitForTimeout') ? 'sleep' : null) }];
      },
    });
    const s = await scoreSuite(dir, strict);
    expect(s.auditErrors).toBe(1);
    expect(s.value).toBe(-1);
  });

  it('coverage failure degrades to 0% instead of throwing', async () => {
    dir = specDir();
    const noCov = fakeAdapter({ async coverage() { throw new Error('no coverage tool'); } });
    const s = await scoreSuite(dir, noCov);
    expect(s.coverage).toBe(0);
    expect(s.value).toBe(0 + 4 * 2 + 5 * 5);
  });
});

// --- passKGenerate ----------------------------------------------------------

describe('passk.passKGenerate', () => {
  let dir: string;
  afterEach(() => {
    if (!dir) return;
    rmSync(dir, { recursive: true, force: true });
    for (let i = 0; i < 3; i++) rmSync(`${dir}.passk-${i}`, { recursive: true, force: true });
  });

  function project(): string {
    const d = mkdtempSync(join(tmpdir(), 'pv-passkgen-'));
    mkdirSync(join(d, 'src'), { recursive: true });
    writeFileSync(join(d, 'src', 'sum.ts'), 'export const sum = (a: number, b: number) => a + b;\n');
    return d;
  }

  /** Adapter whose run() rewards later candidates: pass count read from the spec the generator wrote. */
  function candidateAdapter(): StackAdapter {
    return {
      async run(d: string) {
        const spec = join(d, 'tests', 'gen.test.ts');
        if (!existsSync(spec)) return { green: false, passed: 0, failed: 1, skipped: 0, raw: '' };
        const passed = Number(readFileSync(spec, 'utf8').match(/passes=(\d+)/)?.[1] ?? 0);
        return { green: true, passed, failed: 0, skipped: 0, raw: '' };
      },
      async coverage() { return { statements: 50, branches: 50, functions: 50, lines: 50, ok: true }; },
      async specFiles(d: string) { return existsSync(join(d, 'tests', 'gen.test.ts')) ? ['tests/gen.test.ts'] : []; },
      auditRules() { return []; },
    } as unknown as StackAdapter;
  }

  it('runs K isolated generations, keeps the best, copies its specs back, cleans up', async () => {
    dir = project();
    const logs: string[] = [];
    const { best, all } = await passKGenerate({
      dir,
      kind: 'unit',
      adapter: candidateAdapter(),
      k: 3,
      log: (l) => logs.push(l),
      // candidate i writes a spec whose fake run reports i+1 passes → k2 wins
      generate: async (candidateDir) => {
        const i = Number(candidateDir.match(/\.passk-(\d+)$/)![1]);
        mkdirSync(join(candidateDir, 'tests'), { recursive: true });
        writeFileSync(join(candidateDir, 'tests', 'gen.test.ts'), `// candidate ${i} passes=${i + 1}\n`);
        return true;
      },
    });
    expect(all).toHaveLength(3);
    expect(best?.label).toBe('k2');
    expect(best?.score.tests).toBe(3);
    // winning spec copied back into the real project dir
    expect(readFileSync(join(dir, 'tests', 'gen.test.ts'), 'utf8')).toContain('candidate 2');
    // isolated candidate copies removed
    for (let i = 0; i < 3; i++) expect(existsSync(`${dir}.passk-${i}`)).toBe(false);
    expect(logs.some((l) => l.includes('selected k2'))).toBe(true);
  });

  it('a throwing generator yields a red candidate; all-red → best null, nothing copied back', async () => {
    dir = project();
    const { best, all } = await passKGenerate({
      dir,
      kind: 'unit',
      adapter: candidateAdapter(),
      k: 2,
      generate: async () => { throw new Error('model down'); },
    });
    expect(best).toBeNull();
    expect(all).toHaveLength(2);
    expect(all.every((c) => c.score.value === -1)).toBe(true);
    expect(existsSync(join(dir, 'tests', 'gen.test.ts'))).toBe(false);
    for (let i = 0; i < 2; i++) expect(existsSync(`${dir}.passk-${i}`)).toBe(false);
  });

  it('a candidate that scores red still loses to a green sibling (mixed field)', async () => {
    dir = project();
    const { best } = await passKGenerate({
      dir,
      kind: 'unit',
      adapter: candidateAdapter(),
      k: 2,
      // candidate 1 writes nothing → red; candidate 0 is green
      generate: async (candidateDir) => {
        if (candidateDir.endsWith('.passk-1')) return false;
        mkdirSync(join(candidateDir, 'tests'), { recursive: true });
        writeFileSync(join(candidateDir, 'tests', 'gen.test.ts'), '// candidate 0 passes=2\n');
        return true;
      },
    });
    expect(best?.label).toBe('k0');
    expect(readFileSync(join(dir, 'tests', 'gen.test.ts'), 'utf8')).toContain('candidate 0');
  });
});
