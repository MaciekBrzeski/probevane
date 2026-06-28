import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

// E2E for the interactive "click-to-explain" pipeline demo (wiki /demo/pipeline).
// Drives the REAL wiki server in a real browser — the demo's vanilla-JS drawer is
// hand-built glue, so this spec is its coverage. Verifies that clicking a rune
// node, a group header, and a gate toggle each opens the slide-over drawer with
// the right content (incl. the live injected rule), and that Esc closes it.
const PORT = 4199;
let server: ChildProcess;
const url = `http://localhost:${PORT}/demo/pipeline`;

test.beforeAll(async () => {
  server = spawn('node', ['scripts/wiki.mjs', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500)); // let it bind
});
test.afterAll(() => server?.kill());

async function gotoFeature(page: import('@playwright/test').Page) {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#graph .node').length > 0);
  await page.selectOption('#profile', 'feature');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#graph .nodeLabel')].some((n) => (n.textContent || '').startsWith('red_first')),
  );
}

test('clicking the red_first node opens its rule (the literal injected TDD contract)', async ({ page }) => {
  await gotoFeature(page);
  await page.locator('#graph .node', { hasText: 'red_first' }).first().click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#drawer h3')).toHaveText('red_first');
  await expect(page.locator('#drawer .summary')).toContainText('failing test');
  await expect(page.locator('#drawer pre.rule')).toContainText('TDD');
});

test('clicking a group header explains the group + lists its runes', async ({ page }) => {
  await gotoFeature(page);
  await page.locator('#graph .cluster', { hasText: 'Finish gates' }).first().locator('.cluster-label').click();
  await expect(page.locator('#drawer h3')).toContainText('Finish gates');
  await expect(page.locator('#drawer .kind')).toHaveText('phase');
  expect(await page.locator('#drawer ul li').count()).toBeGreaterThan(0);
});

test('clicking a gate toggle ⓘ explains what it adds; Esc closes the drawer', async ({ page }) => {
  await gotoFeature(page);
  await page.locator('#toggles .i[data-ti="quality"]').click();
  await expect(page.locator('#drawer h3')).toHaveText('quality');
  await expect(page.locator('#drawer ul')).toContainText('quality_gate');
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
});
