import { defineConfig } from 'vitest/config';

// probevane's own tests (dogfood — a test tool should be tested). Pure node env.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**', 'src/brain/anthropic-sdk.ts', 'src/brain/openai-compat.ts'],
    },
  },
});
