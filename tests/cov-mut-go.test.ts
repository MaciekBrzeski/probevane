import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunScope } from '../src/adapters/adapter.js';

// --- temp dir bookkeeping (same pattern as cov-mut-adapters.test.ts) -------
const dirs: string[] = [];
function tmp(prefix = 'pv-covmut-go-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

// Drive goAdapter.run() with `sh` mocked to emit a canned `go test -json`
// stream (same technique as the MUTANT #2 fail-event test in
// cov-mut-adapters.test.ts). `capOutput` is stubbed to identity.
async function runWithStream(stream: string) {
  vi.resetModules();
  vi.doMock('../src/util/exec.js', () => ({
    sh: async () => ({ ok: true, code: 0, stdout: stream, stderr: '' }),
    capOutput: (s: string) => s,
  }));
  const { goAdapter } = await import('../src/adapters/go-test/index.js');
  return goAdapter.run(tmp(), {} as RunScope);
}

// =========================================================================
// MUTANT — go-test/index.ts:30
//   `else if (e.Action === 'skip') counts.skipped++`   (=== → !==)
// Feed a stream containing `skip` action events. With `===` each skip event
// increments skipped; with the `!==` mutant a real skip no longer matches
// the skip branch, so skipped stays 0.
// =========================================================================
describe('goAdapter.run — a skip event increments skipped (kills === → !==)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/util/exec.js');
  });

  it('counts JSON skip events as skips', async () => {
    const stream = [
      '{"Test":"TestPass","Action":"pass"}',
      '{"Test":"TestSkipA","Action":"skip"}',
      '{"Test":"TestSkipB","Action":"skip"}',
      '',
    ].join('\n');
    const r = await runWithStream(stream);
    expect(r.passed).toBe(1);
    expect(r.skipped).toBe(2); // mutant `!== 'skip'` leaves skipped at 0
  });
});

// =========================================================================
// MUTANT — go-test/index.ts:80
//   `const total = passed + failed + skipped`   (+ → -)
// `total` is not returned; it is only observable through
//   green = r.ok && failed === 0 && total > 0 && passed > 0.
// Build a no-failure, skip-heavy suite: passed=1, failed=0, skipped=2.
//   correct total = 1 + 0 + 2 = 3 > 0  → green true
//   mutant `... - skipped`: 1 + 0 - 2 = -1 (not > 0) → green false
// This kills the `+ skipped` occurrence. (The `passed + failed` occurrence
// is unobservable through the public API: it only alters total when
// failed !== 0, but green already requires failed === 0.)
// =========================================================================
describe('goAdapter.run — total is the sum of counts (kills + → -)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/util/exec.js');
  });

  it('a passing, skip-heavy suite is green (total = passed + skipped > 0)', async () => {
    const stream = [
      '{"Test":"TestPass","Action":"pass"}',
      '{"Test":"TestSkipA","Action":"skip"}',
      '{"Test":"TestSkipB","Action":"skip"}',
      '',
    ].join('\n');
    const r = await runWithStream(stream);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.skipped).toBe(2);
    // total = 1 + 0 + 2 = 3 > 0 → green; mutant `- skipped` → 1 - 2 = -1 → green false
    expect(r.green).toBe(true);
  });
});
