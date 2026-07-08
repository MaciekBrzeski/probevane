import { describe, it, expect } from 'vitest';
import { expandSpec, expandSummary } from './expand.js';
import type { RunSpec } from './runspec.js';
import type { PlanItem } from '../commands/plan/build.js';

const parent = (over: Partial<RunSpec> = {}): RunSpec => ({
  id: 'p', prompt: 'add tests', path: 'write_tests', dir: '/repo', kind: 'unit',
  acceptance: { minTests: 3 }, decompose: { perFile: true }, ...over,
});

const items: PlanItem[] = [
  { action: 'generate', target: 'src/a.ts', why: 'no tests', priority: 2 },
  { action: 'generate', target: 'src/b.ts', why: 'coverage gap', priority: 1 },
  { action: 'refactor', target: 'src/c.ts', why: 'complex', priority: 3 },
];

describe('expandSpec', () => {
  it('fans a write_tests parent into one single-file child per generate item', () => {
    const kids = expandSpec(parent(), items);
    expect(kids).toHaveLength(2); // the refactor item is not a generate target
    expect(kids.map((k) => k.only)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(kids.map((k) => k.id)).toEqual(['p-001', 'p-002']);
    expect(kids.every((k) => k.decompose?.perFile === false)).toBe(true);
  });

  it('steers coverage-gap targets at their uncovered lines (targetGaps)', () => {
    const kids = expandSpec(parent(), items);
    expect(kids[0].targetGaps).toBe(false); // "no tests" → whole file
    expect(kids[1].targetGaps).toBe(true); // "coverage gap" → gaps only
  });

  it('returns the parent as one unit when decompose is off', () => {
    expect(expandSpec(parent({ decompose: { perFile: false } }), items)).toEqual([parent({ decompose: { perFile: false } })]);
  });

  it('does not decompose task paths', () => {
    const p = parent({ path: 'refactor', task: 'x' });
    expect(expandSpec(p, items)).toEqual([p]);
  });
});

describe('expandSummary', () => {
  it('counts new-file vs coverage-gap units', () => {
    expect(expandSummary(expandSpec(parent(), items))).toBe('2 unit(s): 1 new-file, 1 coverage-gap');
  });
});
