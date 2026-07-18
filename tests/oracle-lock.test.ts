import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGolden, goldenKey, readGolden, writeGolden, runGoldenOracle } from '../src/loop/oracle-lock.js';

describe('oracle-lock — pure helpers', () => {
  it('goldenKey makes a filesystem-safe key from a module path', () => {
    expect(goldenKey('src/ca-step.ts')).toBe('src_ca-step.ts');
    expect(goldenKey('a/b c:d')).toBe('a_b_c_d');
  });

  it('checkGolden: absent → locked, equal → match, drift → mismatch with a line diff', () => {
    expect(checkGolden(undefined, 'x')).toEqual({ status: 'locked' });
    expect(checkGolden({ producer: 'p', artifact: 'a\nb' }, 'a\nb')).toEqual({ status: 'match' });
    const m = checkGolden({ producer: 'p', artifact: 'a\nb' }, 'a\nc');
    expect(m.status).toBe('mismatch');
    if (m.status === 'mismatch') expect(m.detail).toContain('line 2');
  });
});

describe('oracle-lock — golden round-trip on disk', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pv-oracle-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('write then read returns the same lock', () => {
    writeGolden(dir, 'src/ca-step.ts', { producer: 'echo hi', artifact: 'hi\n', lockedAt: '2026-01-01' });
    expect(readGolden(dir, 'src/ca-step.ts')).toEqual({ producer: 'echo hi', artifact: 'hi\n', lockedAt: '2026-01-01' });
    expect(existsSync(join(dir, '.probevane', 'oracles', 'src_ca-step.ts.json'))).toBe(true);
  });

  it('runGoldenOracle: first green LOCKS, second matches, drift MISMATCHES, bad producer fails', async () => {
    // first green: producer output captured + locked
    const first = await runGoldenOracle(dir, 'k', 'printf "abc"', '2026-01-01');
    expect(first).toEqual({ status: 'locked' });
    expect(JSON.parse(readFileSync(join(dir, '.probevane', 'oracles', 'k.json'), 'utf8')).artifact).toBe('abc');

    // same producer, same output → match
    expect(await runGoldenOracle(dir, 'k', 'printf "abc"')).toEqual({ status: 'match' });

    // drifted output → mismatch (golden is NOT overwritten)
    const drift = await runGoldenOracle(dir, 'k', 'printf "abd"');
    expect(drift.status).toBe('mismatch');
    expect(JSON.parse(readFileSync(join(dir, '.probevane', 'oracles', 'k.json'), 'utf8')).artifact).toBe('abc');

    // producer exits non-zero → producer-failed (no crash)
    const failed = await runGoldenOracle(dir, 'k2', 'exit 3');
    expect(failed.status).toBe('producer-failed');
  });
});
