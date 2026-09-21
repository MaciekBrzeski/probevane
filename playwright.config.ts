import { defineConfig } from '@playwright/test';
// probevane's OWN dashboard e2e (proves the loop GUI works in a real browser).
// reducedMotion keeps rAF-driven ambience (WaveStrip) static so visual
// checkpoints stay deterministic.
export default defineConfig({ testDir: './e2e-dash', use: { headless: true, reducedMotion: 'reduce' }, reporter: 'line' });
