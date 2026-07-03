import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// E2E for the TERMINAL tab: a real browser xterm attached to a daemon PTY
// (opt-in via PROBEVANE_TERMINAL=1). Proves interactive I/O end-to-end and
// that terminal output is glyph-rendered, never innerHTML (XSS-safe).
const PORT = 7745;
let state: string;
let server: ChildProcess;

test.beforeAll(async () => {
  state = mkdtempSync(join(tmpdir(), 'pv-term-'));
  server = spawn('npx', ['tsx', 'src/cli/daemon.ts', '--root', state, '--port', String(PORT)], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: { ...process.env, PROBEVANE_ROOT: process.cwd(), PROBEVANE_QUEUE: '0', PROBEVANE_TERMINAL: '1' },
  });
  await new Promise((r) => setTimeout(r, 2800));
});

test.afterAll(() => {
  server?.kill();
});

test('terminal streams live PTY output into xterm', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${PORT}/`);
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
  await page.waitForTimeout(600);
  // Drive the session directly through the same input route the UI uses.
  await page.evaluate(async () => {
    const id = (window as unknown as { __termId: string }).__termId;
    const es = new EventSource('/term/stream?id=' + id);
    (window as unknown as { __out: string }).__out = '';
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.b) (window as unknown as { __out: string }).__out += atob(m.b);
      } catch { /* heartbeat */ }
    };
    const b64 = btoa("echo trek-console-42\n");
    await fetch('/term/input?id=' + id, { method: 'POST', body: b64 });
  });
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __out: string }).__out), { timeout: 8000 })
    .toContain('trek-console-42');
});

test('terminal output is glyph-rendered, never innerHTML (XSS-safe)', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('button[data-go=terminal]').click();
  await page.locator('#termBash').click();
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const list = await fetch('/term/sessions').then((r) => r.json());
    const id = list.find((s: { live: boolean }) => s.live).id;
    await fetch('/term/input?id=' + id, {
      method: 'POST',
      body: btoa("printf '<img src=x onerror=window.__XSS=1>\\n'\n"),
    });
  });
  await page.waitForTimeout(1500);
  expect(await page.locator('#termMount img').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __XSS?: number }).__XSS)).toBeUndefined();
});
