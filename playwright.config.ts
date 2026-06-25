import { defineConfig } from '@playwright/test';
// probevane's OWN dashboard e2e (proves the loop GUI works in a real browser).
export default defineConfig({ testDir: './e2e-dash', use: { headless: true }, reporter: 'line' });
