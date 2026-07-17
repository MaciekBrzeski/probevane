import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  initControl,
  jobs,
  getQueue,
  isPaused,
  setPaused,
  snapshot,
  loadJobs,
  loadQueue,
  launch,
  cancelJob,
  enqueue,
  supervise,
  streamEvents,
  type Job,
  type ControlCtx,
} from '../src/server/daemon-control.js';
import type { PersistedJob } from '../src/observe/jobs.js';
import { readJsonl } from '../src/util/jsonl.js';
import type { RunRecord } from '../src/cost/ledger.js';

// Unit tests for the daemon control center's NON-SPAWN paths: state accessors,
// snapshot/persist/load logic, request validation, cancel, supervisor guards and
// the SSE file-tail. Spawn paths (startJobProcess / launch happy path / dispatch /
// shipDispatched) are integration-only and deliberately not exercised here.

const sendJson = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  readonly body: string;
  json(): any;
}

function fakeRes(): ServerResponse & FakeRes {
  const chunks: string[] = [];
  const res: any = new EventEmitter();
  res.statusCode = 0;
  res.headers = {};
  res.writeHead = (code: number, headers?: Record<string, string>) => {
    res.statusCode = code;
    Object.assign(res.headers, headers ?? {});
    return res;
  };
  res.write = (c: unknown) => {
    chunks.push(String(c));
    return true;
  };
  res.end = (c?: unknown) => {
    if (c !== undefined) chunks.push(String(c));
  };
  Object.defineProperty(res, 'body', { get: () => chunks.join('') });
  res.json = () => JSON.parse(res.body);
  return res;
}

/** Fake IncomingMessage that emits `body` then end on the next macrotask. */
function fakeReq(body?: string): IncomingMessage {
  const req: any = new EventEmitter();
  Object.assign(req, { url: '/', method: 'POST', headers: {} });
  req.destroy = () => req.emit('error', new Error('destroyed'));
  if (body !== undefined)
    setImmediate(() => {
      req.emit('data', body);
      req.emit('end');
    });
  return req;
}

const pjob = (over: Partial<PersistedJob> = {}): PersistedJob => ({
  id: 'a',
  op: 'quality',
  dir: '/x',
  flags: [],
  status: 'done',
  startedAt: '2026-06-27T00:00:00Z',
  tail: [],
  ...over,
});

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  ts: new Date().toISOString(),
  runId: 'r',
  label: 'generate:app',
  model: 'claude-haiku-4-5',
  tokensIn: 1000,
  tokensOut: 200,
  cacheRead: 0,
  cost: 0.1,
  accepted: true,
  tookOver: false,
  stopReason: 'accepted',
  steps: 5,
  ...over,
});

let root: string;
let ctx: ControlCtx;

function makeCtx(over: Partial<ControlCtx> = {}): ControlCtx {
  return {
    BIN: '/nonexistent/probevane-test-bin',
    JOBS_PATH: join(root, 'jobs.jsonl'),
    QUEUE_PATH: join(root, 'queue.jsonl'),
    JOB_TAIL: 3,
    MAX_JOBS: 5,
    MAX_BODY: 1000,
    QUEUE_ON: false,
    SHIP_ON: false,
    QUARANTINE: 3,
    BUDGET_CAP: 0,
    BUDGET_WINDOW: 24,
    log: vi.fn(async () => {}),
    sendJson,
    scanRuns: async () => ({ records: [], ledgers: 0 }),
    ...over,
  };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'probevane-control-'));
  ctx = makeCtx();
  initControl(ctx);
  jobs.clear();
  setPaused(false);
  await loadQueue(); // fresh (missing) queue.jsonl → empty queue
});

describe('pause flag', () => {
  it('setPaused flips isPaused', () => {
    expect(isPaused()).toBe(false);
    setPaused(true);
    expect(isPaused()).toBe(true);
    setPaused(false);
    expect(isPaused()).toBe(false);
  });
});

describe('snapshot', () => {
  it('drops the process handle and caps the tail to JOB_TAIL', () => {
    const job: Job = {
      ...pjob({ id: 'j1', status: 'running' }),
      tail: ['l1', 'l2', 'l3', 'l4', 'l5'],
      proc: { kill: () => true } as unknown as ChildProcess,
    };
    const s = snapshot(job);
    expect('proc' in s).toBe(false);
    expect(s.tail).toEqual(['l3', 'l4', 'l5']); // JOB_TAIL = 3
    expect(s.id).toBe('j1');
    expect(job.tail).toHaveLength(5); // original untouched
  });
});

describe('loadJobs', () => {
  it('rebuilds the map last-wins and marks orphaned running jobs as error', async () => {
    const lines = [
      pjob({ id: 'a', status: 'running' }), // orphan → error
      pjob({ id: 'b', status: 'running' }),
      pjob({ id: 'b', status: 'done', exitCode: 0 }), // last write wins
    ];
    writeFileSync(ctx.JOBS_PATH, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    await loadJobs();
    expect(jobs.size).toBe(2);
    expect(jobs.get('a')?.status).toBe('error');
    expect(jobs.get('a')?.exitCode).toBe(-1);
    expect(jobs.get('b')?.status).toBe('done');
  });

  it('defaults a missing tail to [] and tolerates a missing file', async () => {
    await loadJobs(); // no jobs.jsonl on disk
    expect(jobs.size).toBe(0);
    const row = pjob({ id: 'c', status: 'done' }) as any;
    delete row.tail;
    writeFileSync(ctx.JOBS_PATH, JSON.stringify(row) + '\n');
    await loadJobs();
    expect(jobs.get('c')?.tail).toEqual([]);
  });
});

describe('loadQueue / getQueue', () => {
  it('reduces the append-only log to one item per id (last wins)', async () => {
    const item = { id: 'q1', op: 'quality', dir: '/x', flags: [], status: 'queued', attempts: 0, enqueuedAt: '2026-06-27T00:00:00Z', nextAt: 0 };
    writeFileSync(
      ctx.QUEUE_PATH,
      JSON.stringify(item) + '\n' + JSON.stringify({ ...item, status: 'done' }) + '\n',
    );
    await loadQueue();
    expect(getQueue()).toHaveLength(1);
    expect(getQueue()[0].status).toBe('done');
  });
});

describe('enqueue', () => {
  it('validates, persists and answers queued', async () => {
    const res = fakeRes();
    await enqueue(fakeReq(JSON.stringify({ op: 'quality', dir: root })), res);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('queued');
    expect(getQueue().some((q) => q.id === body.id && q.dir === root)).toBe(true);
    const onDisk = await readJsonl<{ id: string }>(ctx.QUEUE_PATH);
    expect(onDisk.some((q) => q.id === body.id)).toBe(true);
  });

  it('rejects invalid JSON', async () => {
    const res = fakeRes();
    await enqueue(fakeReq('{oops'), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid JSON body');
  });

  it('rejects an op off the allowlist', async () => {
    const res = fakeRes();
    await enqueue(fakeReq(JSON.stringify({ op: 'rm', dir: root })), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('op must be one of');
  });
});

describe('launch (validation paths only — never reaches spawn)', () => {
  it('rejects invalid JSON', async () => {
    const res = fakeRes();
    await launch(fakeReq('not json'), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid JSON body');
  });

  it('rejects a bad launch plan', async () => {
    const res = fakeRes();
    await launch(fakeReq(JSON.stringify({ op: 'quality' })), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('dir is required');
  });

  it('rejects a dir that does not exist', async () => {
    const res = fakeRes();
    await launch(fakeReq(JSON.stringify({ op: 'quality', dir: join(root, 'nope') })), res);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('dir not found');
  });

  it('caps an oversized body (destroyed request → 400)', async () => {
    initControl(makeCtx({ MAX_BODY: 16 }));
    const res = fakeRes();
    await launch(fakeReq('{' + 'x'.repeat(64)), res); // invalid JSON, over cap
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid JSON body');
  });
});

describe('cancelJob', () => {
  it('404s an unknown id', () => {
    const res = fakeRes();
    cancelJob('zzz', res);
    expect(res.statusCode).toBe(404);
  });

  it('409s a job that is not running', () => {
    jobs.set('j2', { ...pjob({ id: 'j2', status: 'done' }) });
    const res = fakeRes();
    cancelJob('j2', res);
    expect(res.statusCode).toBe(409);
  });

  it('kills a running job via its handle and marks it cancelled', () => {
    const kill = vi.fn();
    const job: Job = { ...pjob({ id: 'j3', status: 'running' }), proc: { kill } as unknown as ChildProcess };
    jobs.set('j3', job);
    const res = fakeRes();
    cancelJob('j3', res);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'j3', status: 'cancelled' });
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(job.status).toBe('cancelled');
  });
});

describe('supervise (guard paths only — never dispatches)', () => {
  it('is a no-op when the queue is off', async () => {
    await supervise();
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it('is a no-op while paused', async () => {
    initControl((ctx = makeCtx({ QUEUE_ON: true })));
    setPaused(true);
    await supervise();
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it('halts the line when the budget cap is blown', async () => {
    initControl(
      (ctx = makeCtx({
        QUEUE_ON: true,
        BUDGET_CAP: 1,
        BUDGET_WINDOW: 24,
        scanRuns: async () => ({ records: [rec({ cost: 5 })], ledgers: 1 }),
      })),
    );
    await supervise();
    expect(isPaused()).toBe(true);
    expect(ctx.log).toHaveBeenCalledWith('error', 'budget_halt', { capUsd: 1, windowHrs: 24 });
  });

  it('returns quietly when nothing is ready', async () => {
    initControl((ctx = makeCtx({ QUEUE_ON: true })));
    await supervise(); // empty queue on disk → nextReady null
    expect(isPaused()).toBe(false);
    expect(ctx.log).not.toHaveBeenCalled();
  });
});

describe('streamEvents', () => {
  it('tails the state-root events mirror as SSE frames until the client disconnects', async () => {
    // /stream tails statePath('events')/<runId>.jsonl (the mirror every run writes,
    // incl. worktree runs) — not the workdir. Point statePath at a temp state root.
    const state = mkdtempSync(join(tmpdir(), 'probevane-state-'));
    process.env.PROBEVANE_STATE = state;
    mkdirSync(join(state, 'events'), { recursive: true });
    writeFileSync(join(state, 'events', 'run-1.jsonl'), '{"a":1}\n{"b":2}\n');
    const dir = mkdtempSync(join(tmpdir(), 'probevane-stream-'));
    const req: any = new EventEmitter();
    const res = fakeRes();
    const done = streamEvents(dir, res, req as IncomingMessage);
    await new Promise((r) => setTimeout(r, 150)); // let the first poll pass run
    req.emit('close');
    await done; // loop exits after its 500ms sleep
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.body).toContain('retry: 1000');
    expect(res.body).toContain('data: {"a":1}');
    expect(res.body).toContain('data: {"b":2}');
  }, 10_000);
});
