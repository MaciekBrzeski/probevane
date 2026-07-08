import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';

// The stopReason-aware supervisor triage (G5): a non-zero child exit is parked or
// retried by WHY the run stopped, not the exit code alone. A deterministic give-up
// (difficulty/max_steps/stuck) parks immediately; a transient 'error' backoff-
// retries while under QUARANTINE. spawn is mocked so no real run happens; scanRuns
// injects the stopReason the "run" recorded.

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { initControl, loadQueue, supervise, getQueue, type ControlCtx } from './daemon-control.js';
import { newItem } from '../observe/queue.js';
import { appendJsonl, readJsonl } from '../util/jsonl.js';
import type { QueueItem } from '../observe/queue.js';
import type { RunRecord } from '../cost/ledger.js';

let nextCode = 0;
function makeChild() {
  const c: any = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = vi.fn();
  setImmediate(() => c.emit('close', nextCode));
  return c;
}

const sendJson = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, {});
  res.end(JSON.stringify(body));
};

let root: string;
function makeCtx(records: RunRecord[], over: Partial<ControlCtx> = {}): ControlCtx {
  return {
    BIN: '/nonexistent/bin', JOBS_PATH: join(root, 'jobs.jsonl'), QUEUE_PATH: join(root, 'queue.jsonl'),
    JOB_TAIL: 3, MAX_JOBS: 5, MAX_BODY: 1000, QUEUE_ON: true, SHIP_ON: false, QUARANTINE: 3,
    BUDGET_CAP: 0, BUDGET_WINDOW: 24, log: vi.fn(async () => {}), sendJson,
    scanRuns: async () => ({ records, ledgers: 1 }), ...over,
  };
}

const rec = (stopReason: string): RunRecord => ({
  ts: '2020-01-01T00:00:00Z', runId: 'r', label: 'generate:x', dir: resolve(root), model: 'ollama',
  tokensIn: 1, tokensOut: 1, cacheRead: 0, cost: 0, accepted: false, tookOver: false, stopReason, steps: 1,
});

async function seedItem(): Promise<QueueItem> {
  const item = newItem('u1', 'generate', root, [], new Date(0).toISOString());
  await appendJsonl(join(root, 'queue.jsonl'), item);
  return item;
}

async function finalStatus(): Promise<QueueItem | undefined> {
  const rows = await readJsonl<QueueItem>(join(root, 'queue.jsonl'));
  const m = new Map<string, QueueItem>();
  for (const r of rows) m.set(r.id, r);
  return m.get('u1');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'probevane-triage-'));
  spawnMock.mockReset();
  spawnMock.mockImplementation(makeChild as any);
});

describe('supervisor dispatch triage', () => {
  it('marks accepted (exit 0) done', async () => {
    nextCode = 0;
    initControl(makeCtx([]));
    await seedItem();
    await loadQueue();
    await supervise();
    expect((await finalStatus())?.status).toBe('done');
  });

  it('PARKS a deterministic give-up (difficulty) instead of retrying', async () => {
    nextCode = 1;
    initControl(makeCtx([rec('difficulty')]));
    await seedItem();
    await loadQueue();
    await supervise();
    const f = await finalStatus();
    expect(f?.status).toBe('error'); // parked, not requeued
    expect(f?.attempts).toBe(1); // only the one attempt — no wasted QUARANTINE retries
  });

  it('PARKS max_steps immediately', async () => {
    nextCode = 1;
    initControl(makeCtx([rec('max_steps')]));
    await seedItem();
    await loadQueue();
    await supervise();
    expect((await finalStatus())?.status).toBe('error');
  });

  it('RETRIES a transient error under QUARANTINE (backoff requeue)', async () => {
    nextCode = 1;
    initControl(makeCtx([rec('error')]));
    await seedItem();
    await loadQueue();
    await supervise();
    const f = await finalStatus();
    expect(f?.status).toBe('queued'); // requeued for another attempt
    expect(f?.nextAt).toBeGreaterThan(0); // backoff stamped
  });

  it('falls back to retry when no stopReason record exists (undefined → transient)', async () => {
    nextCode = 1;
    initControl(makeCtx([])); // no records
    await seedItem();
    await loadQueue();
    await supervise();
    expect((await finalStatus())?.status).toBe('queued');
  });
});
