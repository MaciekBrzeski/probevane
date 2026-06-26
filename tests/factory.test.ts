import { describe, it, expect } from 'vitest';
import { parseRepoList, slug, aggregate, acceptedRepos, type FactoryRepoResult } from '../src/factory/report.js';

const ok = (repo: string, over: Partial<FactoryRepoResult> = {}): FactoryRepoResult => ({
  repo,
  accepted: true,
  stopReason: 'accepted',
  tests: 10,
  coverage: 90,
  cost: 0.1,
  tokensIn: 1000,
  tokensOut: 200,
  reverted: false,
  ...over,
});

const fail = (repo: string, over: Partial<FactoryRepoResult> = {}): FactoryRepoResult => ({
  repo,
  accepted: false,
  stopReason: 'error',
  tests: 0,
  coverage: null,
  cost: 0,
  tokensIn: 0,
  tokensOut: 0,
  reverted: true,
  ...over,
});

describe('parseRepoList', () => {
  it('keeps real paths, skips blanks and # comments', () => {
    const text = ['# a list', '', 'repo-a', '  repo-b  ', '   ', '#repo-c (disabled)', 'repo-d'].join(
      '\n',
    );
    expect(parseRepoList(text)).toEqual(['repo-a', 'repo-b', 'repo-d']);
  });

  it('returns empty for an all-comment/blank file', () => {
    expect(parseRepoList('# only\n\n   \n')).toEqual([]);
  });
});

describe('slug', () => {
  it('makes a filesystem-safe name and strips leading/trailing separators', () => {
    expect(slug('../apps/shop')).toBe('.._apps_shop'); // dots preserved (e.g. v1.2)
    expect(slug('/abs/path/to/repo')).toBe('abs_path_to_repo');
    expect(slug('repo')).toBe('repo');
  });

  it('never yields an empty slug', () => {
    expect(slug('////')).toBe('repo');
    expect(slug('')).toBe('repo');
  });

  it('preserves dots, dashes, underscores', () => {
    expect(slug('my-app_v1.2')).toBe('my-app_v1.2');
  });
});

describe('aggregate', () => {
  it('rolls up counts, accept rate, cost, and tests', () => {
    const results = [ok('a'), ok('b', { tests: 18, cost: 0.05 }), fail('c')];
    const r = aggregate(results, '2026-06-26T00:00:00.000Z');
    expect(r.ts).toBe('2026-06-26T00:00:00.000Z');
    expect(r.repos).toBe(3);
    expect(r.accepted).toBe(2);
    expect(r.acceptRate).toBe(0.667);
    expect(r.totalTests).toBe(28);
    expect(r.totalCost).toBe(0.15);
    expect(r.results).toBe(results);
  });

  it('sums cost without float drift (6-dp round)', () => {
    const r = aggregate([ok('a', { cost: 0.1 }), ok('b', { cost: 0.2 })], 't');
    expect(r.totalCost).toBe(0.3);
  });

  it('handles an empty run (no divide-by-zero)', () => {
    const r = aggregate([], 't');
    expect(r.repos).toBe(0);
    expect(r.accepted).toBe(0);
    expect(r.acceptRate).toBe(0);
    expect(r.totalTests).toBe(0);
    expect(r.totalCost).toBe(0);
  });

  it('all-accepted gives rate 1', () => {
    expect(aggregate([ok('a'), ok('b')], 't').acceptRate).toBe(1);
  });

  it('breaks failures down by stop reason', () => {
    const r = aggregate(
      [ok('a'), fail('b', { stopReason: 'error' }), fail('c', { stopReason: 'difficulty' }), fail('d', { stopReason: 'error' })],
      't',
    );
    expect(r.byStopReason).toEqual({ accepted: 1, error: 2, difficulty: 1 });
  });
});

describe('acceptedRepos (resume)', () => {
  it('returns the set of repos that accepted in a prior report', () => {
    const prior = aggregate([ok('a'), fail('b'), ok('c')], 't');
    const set = acceptedRepos(prior);
    expect([...set].sort()).toEqual(['a', 'c']);
  });
  it('handles null/empty', () => {
    expect(acceptedRepos(null).size).toBe(0);
    expect(acceptedRepos(aggregate([], 't')).size).toBe(0);
  });
});
