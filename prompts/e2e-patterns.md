# E2E patterns — Playwright (@playwright/test)

Tests live in `e2e/<name>.spec.ts`. The app is served at the base URL (from the Playwright config's `webServer`). Use ONLY selectors present in the ground-truth UI inventory.

## PATTERN E1 — page load + core element
```ts
import { test, expect } from '@playwright/test';

test('home page renders the app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible();
});
```

## PATTERN E2 — primary user flow (the money path)
Drive the main interaction end to end and assert the visible result.
```ts
test('user can add a todo', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New todo').fill('write e2e tests');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('write e2e tests')).toBeVisible();
  await expect(page.getByLabel('remaining count')).toHaveText('1 remaining');
});
```

## PATTERN E3 — state change / toggle / delete
Set up via the UI, act, assert the changed state (and the count/label that reflects it).

## PATTERN E4 — isolation
Each test starts from a fresh `page.goto('/')`; do not depend on another test's state. Prefer web-first assertions (`expect(locator).toBeVisible()`) that auto-retry — never `waitForTimeout`.

## Selector rules
- Prefer `getByRole('button', { name })`, `getByLabel(...)`, `getByText(...)`.
- A label like `toggle <text>` or `delete <text>` in the ground truth is an `aria-label` → use `getByLabel`.
- If a locator could match many elements, scope it (`page.getByRole('listitem').filter({ hasText })`).
- Never assert on text the app does not render (check the ground-truth inventory).

## PATTERN E-VIS — visual-regression checkpoint (--visual)
```ts
import { test } from '@playwright/test';
import { checkpoint } from './checkpoint';

test('todo flow looks right', async ({ page }) => {
  await page.goto('/');
  await checkpoint(page, 'empty');                 // baseline of the empty state
  await page.getByLabel('New todo').fill('Buy milk');
  await page.getByRole('button', { name: 'Add' }).click();
  await checkpoint(page, 'one-item', { mask: [page.getByTestId('clock')] }); // mask dynamic bits
});
```
Capture a checkpoint at each meaningful UI state. First run writes the baseline; later runs diff against it (small pixel tolerance, animations frozen). Mask timestamps/ids.
