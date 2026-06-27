import { defineConfig } from 'vitest/config';

// probevane's own tests (dogfood — a test tool should be tested). Pure node env.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli/**',
        'src/brain/anthropic-sdk.ts',
        'src/brain/openai-compat.ts',
        'src/factory/run.ts', // process/fs orchestration (spawn child + revert); pure core in report.ts is tested
        'src/quality/scan.ts', // fs walk/read glue; pure analyzer in analyze.ts is tested
        'src/mfe/scan.ts', // fs walk/read glue; pure parser+rules in federation.ts/standards.ts are tested
        'src/mfe/contract-scan.ts', // fs glue; pure templating in contract.ts is tested
        'src/mfe/driver.ts', // process/fs orchestration; pure rollup in report.ts is tested
        'src/ship/ship.ts', // git/fs orchestration; pure builders in pr.ts are tested
      ],
      // Floors set just below current (stmts/lines 46.6, branch 81.8, funcs 64.2)
      // so the gate catches a real regression but doesn't flake on noise. Raise
      // as coverage climbs — never lower to make a red run pass.
      thresholds: {
        statements: 40,
        lines: 40,
        functions: 55,
        branches: 75,
      },
    },
  },
});
