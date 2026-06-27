import { describe, it, expect } from 'vitest';
import { aggregateMfe, type MfeDriverResult } from '../src/mfe/report.js';
import type { MfeViolation } from '../src/mfe/standards.js';

const r = (over: Partial<MfeDriverResult>): MfeDriverResult => ({
  repo: 'x',
  isMfe: true,
  stages: ['audit'],
  errorsBefore: 0,
  warns: 0,
  grade: 100,
  ...over,
});

describe('aggregateMfe', () => {
  it('counts repos, mfe repos, and skips non-MFE', () => {
    const rep = aggregateMfe([r({ repo: 'a' }), r({ repo: 'b', isMfe: false, stages: [] })], [], 't');
    expect(rep.repos).toBe(2);
    expect(rep.mfeRepos).toBe(1);
  });

  it('sums current errors (after-fix wins over before)', () => {
    const rep = aggregateMfe(
      [r({ repo: 'a', errorsBefore: 3, errorsAfter: 1, stages: ['audit', 'fix'] }), r({ repo: 'b', errorsBefore: 2 })],
      [],
      't',
    );
    expect(rep.totalErrors).toBe(3); // 1 (after) + 2 (before)
  });

  it('counts improved repos (fix lowered errors)', () => {
    const rep = aggregateMfe(
      [r({ repo: 'a', errorsBefore: 3, errorsAfter: 1 }), r({ repo: 'b', errorsBefore: 2, errorsAfter: 2 })],
      [],
      't',
    );
    expect(rep.improved).toBe(1);
  });

  it('averages grade over MFE repos and tallies stages', () => {
    const rep = aggregateMfe(
      [r({ repo: 'a', grade: 80, stages: ['audit', 'contract'] }), r({ repo: 'b', grade: 100, stages: ['audit'] })],
      [],
      't',
    );
    expect(rep.avgGrade).toBe(90);
    expect(rep.byStage).toEqual({ audit: 2, contract: 1 });
  });

  it('passes cross-repo version-align through', () => {
    const v: MfeViolation[] = [{ rule: 'version-align', severity: 'error', message: 'react ^18 vs ^17' }];
    expect(aggregateMfe([r({})], v, 't').versionAlign).toBe(v);
  });

  it('empty → zero, no divide-by-zero', () => {
    const rep = aggregateMfe([], [], 't');
    expect(rep.mfeRepos).toBe(0);
    expect(rep.avgGrade).toBe(0);
  });
});
