import { defineConfig } from 'vitest/config';

// probevane's own tests (dogfood — a test tool should be tested). Pure node env.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'], // summary feeds the spec page + the coverage gate
      include: ['src/**/*.ts'],
      // Excluded = genuine process/fs/network/browser/brain-driving glue with no
      // unit-testable pure logic; these are covered by the fixture/path `eval`,
      // not unit tests. Everything with real logic stays IN and is unit-tested.
      exclude: [
        'src/cli/**', // argv/process glue
        // --- LLM brain drivers (network / IPC / subprocess) ---
        'src/brain/anthropic-sdk.ts',
        'src/brain/openai-compat.ts',
        'src/brain/bridge.ts', // $0 host-serviced fs req/res IPC
        'src/brain/claude-code.ts', // spawns the `claude` CLI
        // --- stack-adapter spawn glue (npm/pytest/cargo/playwright) ---
        'src/adapters/*/run.ts', // run the suite (spawn)
        'src/adapters/*/install.ts', // install deps + write config (spawn/fs)
        // --- control-center UI (browser DOM code; covered by the e2e-dash
        //     Playwright suite against the real daemon, not node unit tests) ---
        'src/ui/**',
        // --- browser / vision (Playwright + LLM image) ---
        'src/visual/capture.ts',
        'src/visual/vision.ts',
        'src/visual/improve.ts', // orchestrates capture→vision→rewrite (browser + LLM)
        'src/e2e/checkpoint.ts',
        // --- loop orchestration that drives the brain+adapter (integration) ---
        'src/loop/run-generation.ts',
        'src/loop/run-path.ts',
        'src/loop/run-docs.ts',
        'src/loop/delegate.ts',
        'src/loop/draft-local.ts',
        // --- fs/process orchestration; pure cores are tested elsewhere ---
        'src/factory/run.ts', // spawn child + revert; pure core in report.ts is tested
        'src/quality/scan.ts', // fs walk/read glue; pure analyzer in analyze.ts is tested
        'src/mfe/scan.ts', // fs walk/read glue; pure parser+rules in federation.ts/standards.ts are tested
        'src/mfe/contract-scan.ts', // fs glue; pure templating in contract.ts is tested
        'src/mfe/driver.ts', // process/fs orchestration; pure rollup in report.ts is tested
        'src/ship/ship.ts', // git/fs orchestration; pure builders in pr.ts are tested
        'src/distill/collect.ts', // trace fs read/write
      ],
      // Floors set just below current (stmts/lines ~92, branch ~91, funcs ~86) so
      // the gate catches a real regression but doesn't flake on noise. Raise as
      // coverage climbs — never lower to make a red run pass.
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 85,
        branches: 90,
      },
    },
  },
});
