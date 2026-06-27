import { describe, it, expect } from 'vitest';
import { buildPlan, untestedTargets, formatPlan } from '../src/plan/build.js';

describe('untestedTargets', () => {
  it('flags sources whose basename appears in no spec', () => {
    const targets = [{ sourcePath: 'src/Cart.tsx' }, { sourcePath: 'src/util.ts' }];
    const specs = ['src/Cart.test.tsx'];
    expect(untestedTargets(targets, specs)).toEqual(['src/util.ts']);
  });
});

describe('buildPlan', () => {
  it('ranks mfe-fix > refactor > generate(untested) > generate(gap), dedups', () => {
    const plan = buildPlan({
      untested: ['a.ts'],
      coverageGaps: ['b.ts'],
      qualityErrors: [{ file: 'big.ts', message: '[file-size] too long' }],
      mfeErrors: [{ message: '[singleton] react', file: 'host' }],
    });
    expect(plan.items.map((i) => i.action)).toEqual(['mfe-fix', 'refactor', 'generate', 'generate']);
    expect(plan.items[0].action).toBe('mfe-fix');
    expect(plan.summary).toContain('2 generate');
  });

  it('dedups the same action+target', () => {
    const plan = buildPlan({ untested: ['a.ts'], coverageGaps: ['a.ts'], qualityErrors: [], mfeErrors: [] });
    expect(plan.items).toHaveLength(1); // a.ts only once (untested wins, higher priority)
    expect(plan.items[0].why).toBe('no tests');
  });

  it('empty signals → empty plan', () => {
    const plan = buildPlan({ untested: [], coverageGaps: [], qualityErrors: [], mfeErrors: [] });
    expect(plan.items).toEqual([]);
    expect(formatPlan(plan)).toContain('Nothing to do');
  });

  it('formatPlan emits a runnable command per item', () => {
    const out = formatPlan(buildPlan({ untested: ['a.ts'], coverageGaps: [], qualityErrors: [], mfeErrors: [] }));
    expect(out).toContain('[generate] a.ts');
    expect(out).toContain('probevane generate a.ts');
  });
});
