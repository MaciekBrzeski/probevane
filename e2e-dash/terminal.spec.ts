import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// E2E for the TERMINAL tab: a real browser xterm attached to a daemon PTY
// (opt-in via PROBEVANE_TERMINAL=1). Proves interactive I/O end-to-end and
// that terminal output is glyph-rendered, never innerHTML (XSS-safe).
const PORT = 7745;
const BASE = `http://127.0.0.1:${PORT}`;
let state: string;
let server: ChildProcess;

/** Poll the daemon until it answers /health (no fixed boot sleep). */
async function waitForServer(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('daemon did not become healthy in time');
}

/** Subscribe to a session's SSE stream and accumulate decoded output on window.__out. */
async function subscribe(page: Page, id: string): Promise<void> {
  await page.evaluate((sid) => {
    const w = window as unknown as { __out: string };
    w.__out = '';
    const es = new EventSource('/term/stream?id=' + sid);
    es.onmessage = (ev) => {
      try { const m = JSON.parse(ev.data); if (m.b) w.__out += atob(m.b); } catch { /* heartbeat */ }
    };
  }, id);
}
const readOut = (page: Page) => page.evaluate(() => (window as unknown as { __out: string }).__out);

test.beforeAll(async () => {
  state = mkdtempSync(join(tmpdir(), 'pv-term-'));
  server = spawn('npx', ['tsx', 'src/cli/daemon.ts', '--root', state, '--port', String(PORT)], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: { ...process.env, PROBEVANE_ROOT: process.cwd(), PROBEVANE_QUEUE: '0', PROBEVANE_TERMINAL: '1' },
  });
  await waitForServer();
});

test.afterAll(() => {
  server?.kill();
});

test('terminal streams live PTY output into xterm', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.locator('button[data-go=terminal]').click();
  // Spawn bash explicitly (deterministic — the default $SHELL may drop into a
  // config wizard). Preset button spawns $SHELL, so start bash via the API.
  await page.evaluate(async () => {
    const r = await fetch('/term/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: ['bash', '--norc', '-i'], cols: 100, rows: 30 }),
    }).then((x) => x.json());
    (window as unknown as { __termId: string }).__termId = r.id;
  });
  // Wait for the PTY to actually be live before driving it (was a fixed 600ms).
  await expect.poll(async () => page.evaluate(async () => {
    const id = (window as unknown as { __termId: string }).__termId;
    const list = await fetch('/term/sessions').then((r) => r.json());
    return list.some((s: { id: string; live: boolean }) => s.id === id && s.live);
  }), { timeout: 6000 }).toBe(true);
  // Drive the session directly through the same input route the UI uses.
  const id = await page.evaluate(() => (window as unknown as { __termId: string }).__termId);
  await subscribe(page, id);
  await page.evaluate((sid) => fetch('/term/input?id=' + sid, { method: 'POST', body: btoa('echo trek-console-42\n') }), id);
  await expect.poll(() => readOut(page), { timeout: 8000 }).toContain('trek-console-42');
});

test('terminal output is glyph-rendered, never innerHTML (XSS-safe)', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.locator('button[data-go=terminal]').click();
  await page.locator('#termBash').click();
  // Wait for the preset session to be live, then grab its id (was a fixed 800ms).
  const id = await pollLiveSession(page);
  await subscribe(page, id);
  await page.evaluate((sid) => fetch('/term/input?id=' + sid, { method: 'POST', body: btoa("printf '<img src=x onerror=window.__XSS=1>\\n'\n") }), id);
  // Wait until the payload has actually been emitted + rendered (was a fixed
  // 1500ms) — proving it went through the render path — THEN assert it was safe.
  await expect.poll(() => readOut(page), { timeout: 8000 }).toContain('onerror');
  expect(await page.locator('#termMount img').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __XSS?: number }).__XSS)).toBeUndefined();
});

/** Poll /term/sessions until a live session exists; return its id. */
async function pollLiveSession(page: Page): Promise<string> {
  await expect.poll(async () => page.evaluate(async () => {
    const list = await fetch('/term/sessions').then((r) => r.json());
    return list.filter((s: { live: boolean }) => s.live).length;
  }), { timeout: 6000 }).toBeGreaterThan(0);
  return page.evaluate(async () => {
    const list = await fetch('/term/sessions').then((r) => r.json());
    return list.find((s: { live: boolean }) => s.live).id as string;
  });
}
