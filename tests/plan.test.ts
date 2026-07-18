import { describe, it, expect } from 'vitest';
import { buildPlan, untestedTargets, formatPlan } from '../src/commands/plan/build.js';

describe('untestedTargets', () => {
  it('flags sources whose basename appears in no spec', () => {
    const targets = [{ sourcePath: 'src/Cart.tsx' }, { sourcePath: 'src/util.ts' }];
    const specs = ['src/Cart.test.tsx'];
    expect(untestedTargets(targets, specs)).toEqual(['src/util.ts']);
  });

  it('counts a target imported by an aggregated spec as tested (content-aware)', () => {
    const targets = [{ sourcePath: 'src/arch/metrics.ts' }, { sourcePath: 'src/arch/lonely.ts' }];
    const specs = ['tests/arch.test.ts']; // path names neither module
    const specTexts = ["import { archMetrics } from '../src/arch/metrics.js';"];
    // metrics is imported → tested; lonely is not → still flagged
    expect(untestedTargets(targets, specs, specTexts)).toEqual(['src/arch/lonely.ts']);
  });

  it('the dir/base token avoids matching a short common basename by accident', () => {
    const targets = [{ sourcePath: 'src/loop/run.ts' }];
    const specs = ['tests/misc.test.ts'];
    const specTexts = ['const run = () => 1; // the word "run" appears but no arch/run import'];
    expect(untestedTargets(targets, specs, specTexts)).toEqual(['src/loop/run.ts']);
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
    // exact per-action counts — asymmetric so a flipped === in byAction is caught
    // (0 fix / 1 refactor / 1 mfe-fix all differ from their !== complements)
    expect(plan.summary).toBe('4 action(s): 2 generate, 1 refactor, 0 fix, 1 mfe-fix');
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
