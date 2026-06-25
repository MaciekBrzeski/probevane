import { test, expect } from '@playwright/test';
import { checkpoint } from '../src/e2e/checkpoint';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// E2E for the live-loop dashboard (`probevane serve`). Drives the REAL server in
// a real browser — the dashboard is NOT untestable glue. Also visual-checks it
// with probevane's own checkpoint helper (dogfooding the H3 visual gate).
const PORT = 7733;
let dir: string;
let server: ChildProcess;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pv-dash-'));
  mkdirSync(join(dir, '.probevane'), { recursive: true });
  // Two events for one run: mid-flight, then accepted.
  const f = join(dir, '.probevane', 'events-run-demo.jsonl');
  const ev = (o: object) => JSON.stringify({ ts: '2026-01-01T00:00:00Z', runId: 'run-demo', toolCalls: 4, gateBlocks: 0, tokensIn: 1200, tokensOut: 300, ...o });
  writeFileSync(f, ev({ step: 3, tool: 'write_file' }) + '\n' + ev({ step: 5, stopReason: 'accepted', accepted: true }) + '\n');
  server = spawn('npx', ['tsx', 'src/cli/serve.ts', dir, '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500)); // let it bind
});

test.afterAll(() => {
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

test('dashboard renders the run from the live SSE stream', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const card = page.locator('[data-run="run-demo"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.locator('[data-step]')).toHaveText('5');         // latest step won
  await expect(card.locator('[data-status=accepted]')).toBeVisible(); // accepted badge
  await checkpoint(page, 'loop-dashboard');                           // visual baseline
});
