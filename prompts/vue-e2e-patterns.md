# E2E patterns — Playwright (Vue app)

Tests live in `e2e/<name>.spec.ts`. The app is served at the base URL. Use only selectors in the ground-truth inventory.

## PATTERN VE1 — load + core element
```ts
import { test, expect } from '@playwright/test';
test('renders the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vue Counter' })).toBeVisible();
});
```

## PATTERN VE2 — primary interaction
```ts
test('increments', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('increment').click();
  await expect(page.getByLabel('count')).toHaveText('1');
});
```

## Rules
- Prefer `getByLabel` / `getByRole`. Web-first assertions (`toHaveText`, `toBeVisible`) auto-retry — never `waitForTimeout`.
- Each test starts from a fresh `page.goto('/')`.
