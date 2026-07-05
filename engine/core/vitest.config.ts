import { defineConfig } from 'vitest/config';

// @facet/core is pure vector math + widget geometry — fully unit-testable, so
// the coverage gate is high. Raise floors as coverage climbs; never lower to
// make a red run pass.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        // 82% today: the gap is defensive `?? 0` / `?? []` guards on impossible
        // states in layout. Inaugural floor at 80; raise as real branches land.
        branches: 80,
      },
    },
  },
});
