import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,js}'],
    coverage: { provider: 'v8', include: ['src/**/*.{ts,svelte}'], exclude: ['src/**/*.{test,spec}.ts'] } },
});
