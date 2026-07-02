import { describe, it, expect, vi, beforeAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Isolate the state root BEFORE any src import: observe/audit resolves AUDIT_PATH
// at module load, and /audit must not read the user's real library state.
const STATE_DIR = await vi.hoisted(async () => {
  const { mkdtempSync: mkTmp } = await import('node:fs');
  const { tmpdir: osTmp } = await import('node:os');
  const { join: j } = await import('node:path');
  const d = mkTmp(j(osTmp(), 'probevane-routes-state-'));
  process.env.PROBEVANE_STATE = d;
  return d;
});

import { initRoutes, handle, type RouteCtx } from '../src/server/daemon-routes.js';
import { initControl, jobs, type ControlCtx } from '../src/server/daemon-control.js';
import { DEFAULT_ALERT_OPTS } from '../src/observe/alerts.js';
import { recordAudit } from '../src/observe/audit.js';
import { formatTurn, userTurn } from '../src/loop/transcript.js';
import type { RunRecord } from '../src/cost/ledger.js';
import type { PersistedJob } from '../src/observe/jobs.js';

// Unit tests for the daemon HTTP router: every GET route + the POST validation
// paths, against a fully faked RouteCtx/ControlCtx (no sockets, no spawns).

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  ts: '2026-06-20T10:00:00.000Z',
  runId: 'r1',
  label: 'generate:apps/alpha',
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

const RECORDS = [
  rec(), // runId r1 → project "alpha"
  rec({ ts: '2026-06-21T10:00:00.000Z', runId: 'r2', label: 'quality:apps/beta', accepted: false, stopReason: 'error' }),
];

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

function fakeReq(url: string, method: string, body?: string): IncomingMessage {
  const req: any = new EventEmitter();
  Object.assign(req, { url, method, headers: {} });
  req.destroy = () => req.emit('error', new Error('destroyed'));
  if (body !== undefined)
    setImmediate(() => {
      req.emit('data', body);
      req.emit('end');
    });
  return req;
}

async function get(url: string) {
  const res = fakeRes();
  await handle(fakeReq(url, 'GET'), res);
  return res;
}

async function post(url: string, body = '') {
  const res = fakeRes();
  await handle(fakeReq(url, 'POST', body), res);
  return res;
}

let WIKI_DIR: string;
let PROJ_DIR: string;
let scanRunsImpl: RouteCtx['scanRuns'];
const logSpy = vi.fn(async () => {});

beforeAll(() => {
  WIKI_DIR = mkdtempSync(join(tmpdir(), 'probevane-wiki-'));
  writeFileSync(join(WIKI_DIR, 'Home.md'), '# Home\n');
  writeFileSync(join(WIKI_DIR, 'project-alpha.md'), '# alpha\n');

  PROJ_DIR = mkdtempSync(join(tmpdir(), 'probevane-proj-'));
  mkdirSync(join(PROJ_DIR, '.probevane', 'diary'), { recursive: true });
  writeFileSync(join(PROJ_DIR, '.probevane', 'diary', 'r1.json'), JSON.stringify({ note: 'went well' }));
  writeFileSync(join(PROJ_DIR, '.probevane', 'transcript-r1.jsonl'), formatTurn(userTurn('r1', 'hello world', '2026-06-20T10:00:00Z')) + '\n');

  scanRunsImpl = async () => ({ records: RECORDS, ledgers: 2 });
  const routeCtx: RouteCtx = {
    VERSION: '9.9.9',
    STARTED: Date.now() - 5000,
    ROOT: STATE_DIR,
    QUEUE_ON: true,
    JOBS_RETURN: 2,
    AUDIT_RETURN: 10,
    DASHBOARD: () => '<html>dash</html>',
    WIKI_DIR,
    alertOpts: DEFAULT_ALERT_OPTS,
    log: logSpy,
    sendJson,
    scanRuns: (...a) => scanRunsImpl(...a),
  };
  const controlCtx: ControlCtx = {
    BIN: '/nonexistent/probevane-test-bin',
    JOBS_PATH: join(STATE_DIR, 'jobs.jsonl'),
    QUEUE_PATH: join(STATE_DIR, 'queue.jsonl'),
    JOB_TAIL: 3,
    MAX_JOBS: 5,
    MAX_BODY: 1000,
    QUEUE_ON: true,
    SHIP_ON: false,
    QUARANTINE: 3,
    BUDGET_CAP: 0,
    BUDGET_WINDOW: 24,
    log: logSpy,
    sendJson,
    scanRuns: (...a) => scanRunsImpl(...a),
  };
  initRoutes(routeCtx);
  initControl(controlCtx);
});

describe('scan-backed metrics routes', () => {
  it('GET /health reports version/uptime/ledgers/queue/paused', async () => {
    const res = await get('/health');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.ok).toBe(true);
    expect(b.version).toBe('9.9.9');
    expect(b.pid).toBe(process.pid);
    expect(b.uptimeSec).toBeGreaterThanOrEqual(4);
    expect(b.stateRoot).toBe(STATE_DIR);
    expect(b.ledgers).toBe(2);
    expect(b.queue).toEqual({ queued: expect.any(Number), running: expect.any(Number), done: expect.any(Number), error: expect.any(Number) });
    expect(b.paused).toBe(false);
  });

  it('GET /aggregate rolls the ledger into totals + daily buckets', async () => {
    const b = (await get('/aggregate')).json();
    expect(b.totals.runs).toBe(2);
    expect(b.daily.map((d: any) => d.date)).toEqual(['2026-06-20', '2026-06-21']);
    expect(b.firstTs).toBe('2026-06-20T10:00:00.000Z');
  });

  it('GET /alerts returns alerts + the effective opts', async () => {
    const b = (await get('/alerts')).json();
    expect(Array.isArray(b.alerts)).toBe(true);
    expect(b.opts).toEqual(DEFAULT_ALERT_OPTS);
  });

  it('GET /metrics serves Prometheus text exposition', async () => {
    const res = await get('/metrics');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('probevane_runs_total 2');
    expect(res.body).toContain('probevane_accepted_total 1');
  });

  it('GET /otel/traces + /otel/metrics serve OTLP payloads', async () => {
    const traces = (await get('/otel/traces')).json();
    expect(traces.resourceSpans).toHaveLength(1);
    const metrics = (await get('/otel/metrics')).json();
    expect(metrics.resourceMetrics).toHaveLength(1);
  });

  it('unknown route → 404 with the path echoed', async () => {
    const res = await get('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('no route /nope');
  });
});

describe('control-center data routes', () => {
  it('GET /queue lists paused/summary/items', async () => {
    const b = (await get('/queue')).json();
    expect(b.paused).toBe(false);
    expect(b.summary).toHaveProperty('queued');
    expect(Array.isArray(b.items)).toBe(true);
  });

  it('GET /jobs strips process handles and caps tails to JOBS_RETURN', async () => {
    jobs.clear();
    const job: PersistedJob & { proc?: unknown } = {
      id: 'j1', op: 'quality', dir: '/x', flags: [], status: 'running',
      startedAt: '2026-06-27T00:00:00Z', tail: ['l1', 'l2', 'l3', 'l4'],
      proc: { kill: () => true },
    };
    jobs.set('j1', job as any);
    const b = (await get('/jobs')).json();
    expect(b.jobs).toHaveLength(1);
    expect('proc' in b.jobs[0]).toBe(false);
    expect(b.jobs[0].tail).toEqual(['l3', 'l4']); // JOBS_RETURN = 2
  });

  it('GET /stream without dir → 400', async () => {
    expect((await get('/stream')).statusCode).toBe(400);
  });

  it('GET /quality without dir → 400; with dir → a quality report', async () => {
    expect((await get('/quality')).statusCode).toBe(400);
    const res = await get(`/quality?dir=${encodeURIComponent(PROJ_DIR)}`);
    expect(res.statusCode).toBe(200);
    expect(typeof res.json()).toBe('object');
  });

  it('GET /ops serves the launch allowlist', async () => {
    const b = (await get('/ops')).json();
    expect(Array.isArray(b.ops)).toBe(true);
    expect(b.ops).toContain('quality');
  });

  it('GET /audit reads the (isolated) audit trail', async () => {
    await recordAudit({ action: 'library.save', target: 'slug-x' });
    const b = (await get('/audit')).json();
    expect(b.count).toBe(1);
    expect(b.entries[0]).toMatchObject({ action: 'library.save', target: 'slug-x' });
  });

  it('GET /projects cross-refs wiki pages with ledger runs', async () => {
    const b = (await get('/projects')).json();
    expect(b.projects).toHaveLength(1);
    expect(b.projects[0]).toMatchObject({ name: 'alpha', slug: 'project-alpha', runCount: 1 });
    expect(b.projects[0].lastRun.op).toBe('generate');
  });

  it('GET /runs pages the ledger newest-first', async () => {
    const b = (await get('/runs?limit=1&offset=0')).json();
    expect(b.total).toBe(2);
    expect(b.runs).toHaveLength(1);
    expect(b.runs[0].runId).toBe('r2'); // newest ts first
  });

  it('GET /run requires dir + a safe runId', async () => {
    expect((await get('/run')).statusCode).toBe(400);
    const res = await get(`/run?dir=${encodeURIComponent(PROJ_DIR)}&runId=${encodeURIComponent('../evil')}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid runId');
  });

  it('GET /run merges record + diary + events summary', async () => {
    const b = (await get(`/run?dir=${encodeURIComponent(PROJ_DIR)}&runId=r1`)).json();
    expect(b.runId).toBe('r1');
    expect(b.record.label).toBe('generate:apps/alpha');
    expect(b.diary).toEqual({ note: 'went well' });
    expect(b.events.steps).toBe(0); // no events file → empty summary
  });

  it('GET /transcript validates params and parses turns', async () => {
    expect((await get('/transcript?dir=/x')).statusCode).toBe(400);
    const b = (await get(`/transcript?dir=${encodeURIComponent(PROJ_DIR)}&runId=r1`)).json();
    expect(b.runId).toBe('r1');
    expect(b.turns).toHaveLength(1);
    expect(b.turns[0]).toMatchObject({ role: 'user', text: 'hello world' });
  });

  it('GET /wiki splits core pages from project pages', async () => {
    const b = (await get('/wiki')).json();
    expect(b.core).toEqual(['Home.md']);
    expect(b.projects).toEqual(['project-alpha.md']);
  });

  it('GET /wiki/raw serves markdown, 404s missing, 400s unsafe names', async () => {
    const ok = await get('/wiki/raw/Home.md');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('text/markdown');
    expect(ok.body).toBe('# Home\n');
    expect((await get('/wiki/raw/missing.md')).statusCode).toBe(404);
    expect((await get('/wiki/raw/evil.txt')).statusCode).toBe(400);
  });

  it('GET / serves the dashboard HTML', async () => {
    const res = await get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe('<html>dash</html>');
  });
});

describe('POST routes (validation paths — no spawns)', () => {
  it('POST /run rejects invalid JSON, bad ops and missing dirs', async () => {
    expect((await post('/run', '{oops')).json().error).toBe('invalid JSON body');
    expect((await post('/run', JSON.stringify({ op: 'rm', dir: '.' }))).json().error).toContain('op must be one of');
    const res = await post('/run', JSON.stringify({ op: 'quality', dir: join(PROJ_DIR, 'nope') }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('dir not found');
  });

  it('POST /cancel requires an id and 404s unknown jobs', async () => {
    const noId = await post('/cancel');
    expect(noId.statusCode).toBe(400);
    expect(noId.json().error).toBe('id query param required');
    expect((await post('/cancel?id=zzz')).statusCode).toBe(404);
  });

  it('POST /enqueue queues a validated plan', async () => {
    const res = await post('/enqueue', JSON.stringify({ op: 'quality', dir: PROJ_DIR }));
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.status).toBe('queued');
    const q = (await get('/queue')).json();
    expect(q.items.some((i: any) => i.id === b.id)).toBe(true);
  });

  it('POST to a non-POST route falls through to GET handling', async () => {
    expect((await post('/nope')).statusCode).toBe(404);
  });
});

describe('error handling', () => {
  it('a throwing handler → 500 + request_error log', async () => {
    const prev = scanRunsImpl;
    scanRunsImpl = async () => {
      throw new Error('scan exploded');
    };
    try {
      const res = await get('/aggregate');
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain('scan exploded');
      expect(logSpy).toHaveBeenCalledWith('error', 'request_error', { url: '/aggregate', error: 'scan exploded' });
    } finally {
      scanRunsImpl = prev;
    }
  });
});
