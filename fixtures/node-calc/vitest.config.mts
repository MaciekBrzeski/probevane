import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
  coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/**/*.{test,spec}.ts'] },
} });
