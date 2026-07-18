import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { byDir, writeMutationBaseline, readMutationBaseline, checkRatchet } from '../src/loop/mutation-baseline.js';
import type { MutationRun } from '../src/loop/mutation.js';

// Minimal MutationRun with only the byFile field the ratchet reads.
const run = (byFile: Record<string, { total: number; killed: number }>): MutationRun => {
  const total = Object.values(byFile).reduce((s, v) => s + v.total, 0);
  const killed = Object.values(byFile).reduce((s, v) => s + v.killed, 0);
  return { total, killed, survived: total - killed, score: total ? killed / total : 1, survivors: [], byFile, sampled: false };
};

describe('mutation ratchet — byDir', () => {
  it('rolls per-file tallies up to top-level dirs and scores each', () => {
    const d = byDir(run({
      'src/loop/a.ts': { total: 10, killed: 9 },
      'src/loop/runes/b.ts': { total: 10, killed: 8 },
      'src/ui/x.ts': { total: 4, killed: 2 },
    }));
    expect(d.loop).toEqual({ total: 20, killed: 17, score: 17 / 20 });
    expect(d.ui).toEqual({ total: 4, killed: 2, score: 0.5 });
  });
});

describe('mutation ratchet — write/read/check', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pv-mut-base-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes per-dir floors (rounded down to 0.1 bands) and reads them back', () => {
    const n = writeMutationBaseline(dir, run({ 'src/loop/a.ts': { total: 4, killed: 3 }, 'src/ui/x.ts': { total: 2, killed: 2 } }));
    expect(n).toBe(2);
    const base = readMutationBaseline(dir);
    expect(base).toEqual({ loop: 0.7, ui: 1 }); // 0.75 → band 0.7
    // persisted as JSON on disk
    expect(JSON.parse(readFileSync(join(dir, '.probevane', 'mutation-baseline.json'), 'utf8'))).toEqual({ loop: 0.7, ui: 1 });
  });

  it('flags a dir that dropped a full band, passes noise within the band', () => {
    writeMutationBaseline(dir, run({ 'src/loop/a.ts': { total: 10, killed: 9 } })); // floor loop=0.9
    const base = readMutationBaseline(dir);
    // regressed a whole band: loop now 0.7
    const bad = checkRatchet(run({ 'src/loop/a.ts': { total: 10, killed: 7 } }), base);
    expect(bad).toEqual([{ dir: 'loop', floor: 0.9, actual: 0.7 }]);
    // improved: loop now 1.0 → no regression
    expect(checkRatchet(run({ 'src/loop/a.ts': { total: 10, killed: 10 } }), base)).toEqual([]);
    // unchanged → no regression
    expect(checkRatchet(run({ 'src/loop/a.ts': { total: 10, killed: 9 } }), base)).toEqual([]);
  });

  it('no baseline → no-op; missing dir skipped; new dir allowed', () => {
    expect(checkRatchet(run({ 'src/loop/a.ts': { total: 4, killed: 1 } }), undefined)).toEqual([]);
    const base = { loop: 0.9, gone: 0.8 };
    // `gone` absent from the run → skipped; `ui` new since baseline → allowed
    const r = checkRatchet(run({ 'src/loop/a.ts': { total: 4, killed: 4 }, 'src/ui/x.ts': { total: 4, killed: 0 } }), base);
    expect(r).toEqual([]);
  });
});
