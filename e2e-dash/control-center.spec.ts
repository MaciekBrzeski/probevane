import { test, expect } from '@playwright/test';
import { checkpoint } from '../src/e2e/checkpoint';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// E2E for the unified control center (`probevane daemon`). Drives the REAL daemon
// in a real browser: Projects (wiki-derived) → Runs history → Run Detail drawer
// with the FULL transcript. Includes an XSS payload turn to prove the transcript
// renders via textContent, not innerHTML.
const PORT = 7744;
let base: string, root: string, state: string, proj: string;
let server: ChildProcess;

const RUN_ID = 'run-demo';

test.beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'pv-cc-'));
  root = join(base, 'root');
  state = join(base, 'state');
  proj = join(base, 'demo'); // basename "demo" ↔ project-demo.md ↔ label target
  mkdirSync(join(root, 'docs', 'wiki'), { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(join(proj, '.probevane', 'diary'), { recursive: true });

  writeFileSync(join(root, 'docs', 'wiki', 'project-demo.md'), '# demo — Specification\n\n## Overview\n- 1 module\n');

  // Ledger record (state root) — label target basename "demo" links to the project.
  writeFileSync(join(state, 'runs.jsonl'), JSON.stringify({
    ts: '2026-01-01T00:00:00Z', runId: RUN_ID, label: `generate:${proj}`, model: 'kimi-k2.7-code',
    tokensIn: 1000, tokensOut: 200, cacheRead: 0, cost: 0, accepted: true, tookOver: false,
    stopReason: 'accepted', steps: 3,
  }) + '\n');

  // Events (per-run, in the project dir).
  const ev = (o: object) => JSON.stringify({ ts: '2026-01-01T00:00:00Z', runId: RUN_ID, toolCalls: 2, gateBlocks: 0, tokensIn: 1000, tokensOut: 200, ...o });
  writeFileSync(join(proj, '.probevane', `events-${RUN_ID}.jsonl`),
    ev({ step: 1, tool: 'write_file' }) + '\n' + ev({ step: 3, stopReason: 'accepted', accepted: true }) + '\n');

  // Diary summary.
  writeFileSync(join(proj, '.probevane', 'diary', `${RUN_ID}.json`), JSON.stringify({ runId: RUN_ID, accepted: true, steps: 3 }));

  // Transcript — one turn carries an XSS payload; it MUST render as text.
  const turn = (o: object) => JSON.stringify({ ts: '2026-01-01T00:00:00Z', runId: RUN_ID, ...o });
  writeFileSync(join(proj, '.probevane', `transcript-${RUN_ID}.jsonl`),
    turn({ step: 0, role: 'user', text: 'write tests for demo' }) + '\n' +
    turn({ step: 1, role: 'assistant', model: 'kimi-k2.7-code',
      text: 'Here is a test. <img src=x onerror="window.__XSS=1">',
      toolCalls: [{ name: 'write_file', input: { path: 'a.test.ts', contents: 'ok' } }],
      toolResults: [{ name: 'write_file', ok: true, content: 'wrote a.test.ts' }] }) + '\n');

  server = spawn('npx', ['tsx', 'src/cli/daemon.ts', '--root', state, '--port', String(PORT)],
    { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PROBEVANE_ROOT: root, PROBEVANE_QUEUE: '0' } });
  await new Promise((r) => setTimeout(r, 2800));
});

test.afterAll(() => {
  server?.kill();
  rmSync(base, { recursive: true, force: true });
});

test('projects tab lists the wiki-derived project', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const card = page.locator('.card', { hasText: 'demo' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText('1 run');
  await checkpoint(page, 'control-center-projects');
});

test('run detail drawer renders the full transcript', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('nav.tabs button[data-go="runs"]').click();
  const row = page.locator('#runs tbody tr', { hasText: 'demo' });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  const drawer = page.locator('#drawer.open');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('write tests for demo');   // seed user turn
  await expect(drawer).toContainText('kimi-k2.7-code');          // model badge
  await expect(drawer.locator('details', { hasText: 'write_file' }).first()).toBeVisible();
});

test('transcript XSS payload renders as text, not markup', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('nav.tabs button[data-go="runs"]').click();
  await page.locator('#runs tbody tr', { hasText: 'demo' }).click();
  await expect(page.locator('#drawer.open')).toBeVisible();
  await expect(page.locator('#drawer')).toContainText('window.__XSS=1'); // shown verbatim
  // The payload must NOT have created an <img> or run its handler.
  expect(await page.locator('#drawer img').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __XSS?: number }).__XSS)).toBeUndefined();
});
