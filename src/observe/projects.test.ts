// src/observe/projects.test.ts
import { describe, it, expect } from 'vitest';
import { projectName, projectOf, buildProjects } from './projects.js';
import type { RunRecord } from '../cost/ledger.js';

const makeRecord = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId: 'r1',
  ts: '2024-01-01T00:00:00Z',
  label: 'generate:fixtures/x',
  model: 'gpt-4o',
  tokensIn: 10,
  tokensOut: 20,
  cacheRead: 0,
  accepted: true,
  tookOver: false,
  stopReason: 'done',
  steps: 1,
  cost: 0.1,
  ...overrides,
});

describe('projectName', () => {
  it('strips project- prefix and .md suffix', () => {
    expect(projectName('project-react-shop.md')).toBe('react-shop');
  });

  it('returns the middle name for a longer slug', () => {
    expect(projectName('project-my-cool-project.md')).toBe('my-cool-project');
  });

  it('leaves a name without prefix or suffix unchanged', () => {
    expect(projectName('react-shop')).toBe('react-shop');
  });

  it('strips only the first project- occurrence', () => {
    expect(projectName('project-project-alpha.md')).toBe('project-alpha');
  });

  it('handles a filename with no .md suffix', () => {
    expect(projectName('project-foo')).toBe('foo');
  });
});

describe('projectOf', () => {
  it('extracts basename from an op-prefixed label', () => {
    expect(projectOf('op:some/path/react-shop')).toBe('react-shop');
  });

  it('extracts basename from a label without prefix', () => {
    expect(projectOf('some/path/react-shop')).toBe('react-shop');
  });

  it('handles backslashes', () => {
    expect(projectOf('op:some\\path\\react-shop')).toBe('react-shop');
  });

  it('drops trailing slashes', () => {
    expect(projectOf('op:some/path/react-shop/')).toBe('react-shop');
  });

  it('drops trailing backslashes', () => {
    expect(projectOf('op:some\\path\\react-shop\\')).toBe('react-shop');
  });

  it('returns the whole label when there is no separator', () => {
    expect(projectOf('react-shop')).toBe('react-shop');
  });

  it('returns empty string for an empty target after colon', () => {
    expect(projectOf('op:')).toBe('');
  });

  it('returns empty string for an empty input', () => {
    expect(projectOf('')).toBe('');
  });
});

describe('buildProjects', () => {
  it('returns an empty array when given empty inputs', () => {
    expect(buildProjects([], [])).toEqual([]);
  });

  it('filters out markdown files that are not project pages', () => {
    const result = buildProjects(['README.md', 'project-alpha.md', 'index.md'], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'alpha',
      slug: 'project-alpha',
      runCount: 0,
      acceptRate: 0,
    });
  });

  it('matches records to projects by basename and computes counts', () => {
    const records: RunRecord[] = [
      makeRecord({ runId: 'r1', label: 'generate:projects/alpha', accepted: true, ts: '2024-01-01T00:00:00Z' }),
      makeRecord({ runId: 'r2', label: 'generate:projects/alpha', accepted: false, ts: '2024-01-02T00:00:00Z' }),
      makeRecord({ runId: 'r3', label: 'generate:projects/beta', accepted: true, ts: '2024-01-03T00:00:00Z' }),
    ];
    const result = buildProjects(['project-alpha.md', 'project-beta.md'], records);
    expect(result).toHaveLength(2);
    const alpha = result.find((p) => p.name === 'alpha')!;
    const beta = result.find((p) => p.name === 'beta')!;
    expect(alpha.runCount).toBe(2);
    expect(alpha.acceptRate).toBe(0.5);
    expect(beta.runCount).toBe(1);
    expect(beta.acceptRate).toBe(1);
  });

  it('maps the newest run to lastRun', () => {
    const records: RunRecord[] = [
      makeRecord({ runId: 'old', label: 'generate:projects/alpha', accepted: true, ts: '2024-01-01T00:00:00Z', stopReason: 'first', cost: 0.1 }),
      makeRecord({ runId: 'new', label: 'review:projects/alpha', accepted: false, ts: '2024-01-05T00:00:00Z', stopReason: 'second', cost: 0.2 }),
    ];
    const result = buildProjects(['project-alpha.md'], records);
    expect(result[0].lastRun).toEqual({
      runId: 'new',
      ts: '2024-01-05T00:00:00Z',
      op: 'review',
      accepted: false,
      stopReason: 'second',
      cost: 0.2,
    });
  });

  it('sorts projects by most recent ts descending, then name ascending', () => {
    const records: RunRecord[] = [
      makeRecord({ label: 'generate:projects/beta', ts: '2024-01-02T00:00:00Z' }),
      makeRecord({ label: 'generate:projects/alpha', ts: '2024-01-03T00:00:00Z' }),
      makeRecord({ label: 'generate:projects/gamma', ts: '2024-01-01T00:00:00Z' }),
    ];
    const result = buildProjects(['project-alpha.md', 'project-beta.md', 'project-gamma.md', 'project-delta.md'], records);
    expect(result.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });

  it('ignores records whose project does not match any wiki page', () => {
    const records: RunRecord[] = [makeRecord({ label: 'generate:projects/unknown' })];
    const result = buildProjects(['project-alpha.md'], records);
    expect(result[0].runCount).toBe(0);
    expect(result[0].acceptRate).toBe(0);
  });

  it('handles records with labels that have no op prefix', () => {
    const records: RunRecord[] = [makeRecord({ label: 'projects/alpha', accepted: true, ts: '2024-01-01T00:00:00Z' })];
    const result = buildProjects(['project-alpha.md'], records);
    expect(result[0].lastRun?.op).toBe('projects/alpha');
  });

  it('sets acceptRate to 0 when there are no matched runs', () => {
    const result = buildProjects(['project-alpha.md'], []);
    expect(result[0].acceptRate).toBe(0);
    expect(result[0].runCount).toBe(0);
  });
});
