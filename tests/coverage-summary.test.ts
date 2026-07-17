import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCoverageSummary } from '../src/adapters/coverage-summary.js';

/** A temp dir with coverage/coverage-summary.json holding the given total pcts. */
function withSummary(total: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pv-cov-'));
  mkdirSync(join(dir, 'coverage'), { recursive: true });
  writeFileSync(join(dir, 'coverage', 'coverage-summary.json'), JSON.stringify({ total }));
  return dir;
}

describe('readCoverageSummary', () => {
  it('parses total percentages and marks ok', async () => {
    const dir = withSummary({
      statements: { pct: 91.5 }, branches: { pct: 88 }, functions: { pct: 100 }, lines: { pct: 92.3 },
    });
    expect(await readCoverageSummary(dir)).toEqual({
      statements: 91.5, branches: 88, functions: 100, lines: 92.3, ok: true,
    });
  });

  it('returns zeros + ok:false when the summary is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-cov-none-'));
    expect(await readCoverageSummary(dir)).toEqual({
      statements: 0, branches: 0, functions: 0, lines: 0, ok: false,
    });
  });

  it('returns ok:false on unparsable JSON (never throws)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-cov-bad-'));
    mkdirSync(join(dir, 'coverage'), { recursive: true });
    writeFileSync(join(dir, 'coverage', 'coverage-summary.json'), '{ not json');
    expect((await readCoverageSummary(dir)).ok).toBe(false);
  });
});
