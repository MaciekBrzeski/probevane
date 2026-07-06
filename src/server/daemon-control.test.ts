import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Cover the SPAWN paths of the daemon control center that the sibling
// tests/daemon-control.test.ts deliberately leaves to integration: readBody's
// buffering + over-cap destroy, and launch's happy path (evictOldJobs +
// startJobProcess: stdout/stderr tail capping and the child `close` lifecycle
// that marks done/error/cancelled and persists). child_process.spawn is mocked
// with a controllable fake child so no real process is ever created.

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import {
  initControl,
  jobs,
  snapshot,
  launch,
  readBody,
  type Job,
  type ControlCtx,
} from './daemon-control.js';
import type { PersistedJob } from '../observe/jobs.js';
import { readJsonl } from '../util/jsonl.js';

let lastChild: any;
function makeChild() {
  const c: any = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.pid = 4321;
  c.kill = vi.fn();
  lastChild = c;
  return c;
}

const sendJson = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

function fakeRes(): ServerResponse & { statusCode: number; json(): any } {
  const chunks: string[] = [];
  const res: any = new EventEmitter();
  res.statusCode = 0;
  res.writeHead = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.write = (c: unknown) => {
    chunks.push(String(c));
    return true;
  };
  res.end = (c?: unknown) => {
    if (c !== undefined) chunks.push(String(c));
  };
  res.json = () => JSON.parse(chunks.join(''));
  return res;
}

/** Bare EventEmitter request whose `destroy` emits 'error' (like a real socket). */
function makeReq(): IncomingMessage & { destroy: () => void } {
  const req: any = new EventEmitter();
  req.destroy = () => req.emit('error', new Error('destroyed'));
  return req;
}

function launchReq(body: string): IncomingMessage {
  const req: any = new EventEmitter();
  req.destroy = () => req.emit('error', new Error('destroyed'));
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
  startedAt: '2020-01-01T00:00:00Z',
  tail: [],
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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'probevane-control-spawn-'));
  ctx = makeCtx();
  initControl(ctx);
  jobs.clear();
  spawnMock.mockReset();
  spawnMock.mockImplementation(makeChild as any);
});

describe('readBody', () => {
  it('buffers the full body and resolves it on end', async () => {
    const req = makeReq();
    const p = readBody(req, 1000);
    req.emit('data', 'hello ');
    req.emit('data', 'world');
    req.emit('end');
    expect(await p).toBe('hello world');
  });

  it('destroys the socket and resolves the buffered data when over cap', async () => {
    const req = makeReq();
    const destroy = vi.spyOn(req, 'destroy');
    const p = readBody(req, 4);
    req.emit('data', 'way too long'); // > 4 bytes → destroy()
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(await p).toBe('way too long'); // resolved via the 'error' path, not hung
  });

  it('resolves the empty string when the request errors before any data', async () => {
    const req = makeReq();
    const p = readBody(req, 10);
    req.emit('error', new Error('reset'));
    expect(await p).toBe('');
  });
});

describe('launch happy path (mocked spawn)', () => {
  it('spawns the child, wires the tail, and close marks the job done + persists', async () => {
    const res = fakeRes();
    await launch(launchReq(JSON.stringify({ op: 'quality', dir: root })), res);

    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    expect(res.json().status).toBe('running');
    expect(spawnMock).toHaveBeenCalledWith(
      ctx.BIN,
      ['quality', root, ...[]],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const job = jobs.get(id)!;
    expect(job.pid).toBe(4321);
    expect(job.proc).toBe(lastChild);

    // stdout/stderr lines are appended and the tail is capped to JOB_TAIL (3).
    lastChild.stdout.emit('data', Buffer.from('a\nb\nc\nd\n'));
    expect(job.tail).toEqual(['b', 'c', 'd']);
    lastChild.stderr.emit('data', Buffer.from('e\n'));
    expect(job.tail).toEqual(['c', 'd', 'e']);

    // close(0) → done, records exit + end, clears the proc handle, logs job_done.
    lastChild.emit('close', 0);
    expect(job.status).toBe('done');
    expect(job.exitCode).toBe(0);
    expect(job.proc).toBeUndefined();
    expect(typeof job.endedAt).toBe('string');
    expect(ctx.log).toHaveBeenCalledWith(
      'info',
      'job_done',
      expect.objectContaining({ id, status: 'done', exitCode: 0 }),
    );

    await new Promise((r) => setTimeout(r, 30)); // let the fire-and-forget persist land
    const rows = await readJsonl<PersistedJob>(ctx.JOBS_PATH);
    const mine = rows.filter((r) => r.id === id);
    expect(mine.at(-1)?.status).toBe('done');
  });

  it('marks the job error on a non-zero exit code', async () => {
    const res = fakeRes();
    await launch(launchReq(JSON.stringify({ op: 'quality', dir: root })), res);
    const id = res.json().id as string;
    const job = jobs.get(id)!;
    lastChild.emit('close', 2);
    expect(job.status).toBe('error');
    expect(job.exitCode).toBe(2);
  });

  it('keeps a cancelled job cancelled when its child later closes', async () => {
    const res = fakeRes();
    await launch(launchReq(JSON.stringify({ op: 'quality', dir: root })), res);
    const id = res.json().id as string;
    const job = jobs.get(id)!;
    job.status = 'cancelled'; // as /cancel would have set it
    lastChild.emit('close', 0);
    expect(job.status).toBe('cancelled'); // status guard respected
    expect(job.exitCode).toBe(0); // exit still recorded
  });

  it('evicts the oldest finished job when the map exceeds MAX_JOBS', async () => {
    for (let i = 0; i < 5; i++) {
      const j: Job = { ...pjob({ id: `old${i}`, status: 'done' }), startedAt: `2020-01-01T00:00:0${i}Z` };
      jobs.set(j.id, j);
    }
    expect(jobs.size).toBe(5); // already at MAX_JOBS

    const res = fakeRes();
    await launch(launchReq(JSON.stringify({ op: 'quality', dir: root })), res);
    const id = res.json().id as string;

    expect(jobs.size).toBe(5); // back within budget
    expect(jobs.has('old0')).toBe(false); // oldest finished evicted
    expect(jobs.has('old4')).toBe(true);
    expect(jobs.has(id)).toBe(true); // the new running job kept
  });
});

describe('snapshot (spawn-file sanity)', () => {
  it('omits the proc handle so a live job can be persisted', () => {
    const job: Job = { ...pjob({ id: 's1', status: 'running' }), tail: ['x'], proc: makeChild() };
    const s = snapshot(job);
    expect('proc' in s).toBe(false);
    expect(s.id).toBe('s1');
  });
});
