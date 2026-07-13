import { expect, type Page, type Locator } from '@playwright/test';

// Visual-regression checkpoint — a thin, opinionated wrapper over Playwright's
// toHaveScreenshot. First run writes the baseline; later runs diff against it
// with a small pixel tolerance and animations frozen. Mask dynamic regions
// (timestamps, ids) so the diff stays meaningful. Copied into a project's
// e2e/ by the visual gate so specs can `import { checkpoint } from './checkpoint'`.
export interface CheckpointOpts {
  /** Locators to blank out before diffing (dynamic/time-sensitive UI). */
  mask?: Locator[];
  /** Allowed fraction of differing pixels (default 1%). */
  tolerance?: number;
  /** Screenshot the full scrollable page (default true). */
  fullPage?: boolean;
}

/** Snapshot the page as `name` and diff against the stored baseline (first run writes it). */
export async function checkpoint(page: Page, name: string, opts: CheckpointOpts = {}): Promise<void> {
  // Best-effort settle — a short bounded wait, so a page holding an open
  // connection (SSE/websocket) never reaches "networkidle" and doesn't hang.
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  await expect(page).toHaveScreenshot(`${name}.png`, {
    maxDiffPixelRatio: opts.tolerance ?? 0.01,
    mask: opts.mask,
    fullPage: opts.fullPage ?? true,
    animations: 'disabled',
  });
}
