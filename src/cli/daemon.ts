import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdir, readFile, stat, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stateRoot } from '../util/state.js';
import { readRuns, type RunRecord } from '../cost/ledger.js';
import { appendJsonl, readJsonl } from '../util/jsonl.js';
import { aggregateOverTime } from '../observe/aggregate.js';
import { computeAlerts, shouldHalt, DEFAULT_ALERT_OPTS } from '../observe/alerts.js';
import { overCap } from '../cost/budget.js';
import { backoffMs } from '../observe/quarantine.js';
import { buildAlertPayload, newAlerts, alertKey } from '../observe/notify.js';
import { readAudit } from '../observe/audit.js';
import { tracesPayload, metricsPayload, prometheusText } from '../observe/otel.js';
import { validateLaunch } from '../observe/launch.js';
import { reduceJobs, jobsToEvict, type PersistedJob } from '../observe/jobs.js';
import { reduceQueue, nextReady, newItem, mark, queueSummary, type QueueItem } from '../observe/queue.js';
import { shipRun, latestDiary } from '../ship/ship.js';
import { scanProject } from '../quality/scan.js';
import { tailFrom, sseFrame } from '../loop/observe.js';

// probevane daemon [--port N] [--root <stateDir>] [--interval SEC]
//
// Long-running OPERATE/OBSERVE service (Phase 4). Scans every ledger under the
// state root (the global runs.jsonl + each factory run's isolated one), and over
// HTTP serves: /health, /aggregate (cost/acceptance over time), /alerts (cost
// spike / acceptance drop / error burst), /audit (library-mutation trail). On an
// interval it re-evaluates alerts and writes them to a structured log. Graceful
// shutdown on SIGTERM/SIGINT; an uncaught error is logged, not fatal (supervision).
// Read-only over state — never mutates a ledger or library.

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const PORT = Number(flag('--port') ?? process.env.PROBEVANE_DAEMON_PORT ?? 7766);
const ROOT = resolve(flag('--root') ?? stateRoot());
const INTERVAL = Number(flag('--interval') ?? 60) * 1000;
const LOG_PATH = join(ROOT, 'daemon.log.jsonl'); // self-contained under the scanned root
const JOBS_PATH = join(ROOT, 'jobs.jsonl'); // persisted launched-job history (restart-safe)
const STARTED = Date.now();
const VERSION = await pkgVersion();

// Configurable limits (defaults preserve prior behaviour).
const MAX_BODY = Number(process.env.PROBEVANE_DAEMON_MAX_BODY ?? 1_000_000);
const JOB_TAIL = Number(process.env.PROBEVANE_DAEMON_JOB_TAIL ?? 200); // lines kept per job
const JOBS_RETURN = Number(process.env.PROBEVANE_DAEMON_JOBS_RETURN ?? 40); // tail lines in /jobs
const AUDIT_RETURN = Number(process.env.PROBEVANE_DAEMON_AUDIT ?? 200); // entries in /audit
const MAX_JOBS = Number(process.env.PROBEVANE_DAEMON_MAX_JOBS ?? 200); // in-memory job cap
const LOG_MAX_BYTES = Number(process.env.PROBEVANE_DAEMON_LOG_MAX ?? 5_000_000); // rotate threshold

const alertOpts = {
  ...DEFAULT_ALERT_OPTS,
  spikeFactor: Number(process.env.PROBEVANE_ALERT_SPIKE ?? DEFAULT_ALERT_OPTS.spikeFactor),
  dropDelta: Number(process.env.PROBEVANE_ALERT_DROP ?? DEFAULT_ALERT_OPTS.dropDelta),
  errorBurst: Number(process.env.PROBEVANE_ALERT_ERRORS ?? DEFAULT_ALERT_OPTS.errorBurst),
};

async function pkgVersion(): Promise<string> {
  const p = join(process.env.PROBEVANE_ROOT ?? resolve('.'), 'package.json');
  return readFile(p, 'utf8')
    .then((s) => JSON.parse(s).version as string)
    .catch(() => '0.0.0');
}

/** Rotate the daemon log to `.1` once it grows past LOG_MAX_BYTES (keeps one gen). */
async function rotateLogIfBig() {
  const sz = (await stat(LOG_PATH).catch(() => null))?.size ?? 0;
  if (sz > LOG_MAX_BYTES) await rename(LOG_PATH, LOG_PATH + '.1').catch(() => {});
}

/** Structured log line — to the daemon log (atomic, rotated) and stderr. */
async function log(level: string, event: string, data: Record<string, unknown> = {}) {
  const line = { ts: new Date().toISOString(), level, event, ...data };
  console.error(`[daemon] ${event} ${JSON.stringify(data)}`);
  await rotateLogIfBig();
  await appendJsonl(LOG_PATH, line).catch(() => {});
}

/** Find every runs.jsonl under `root` (global + factory/<run>/<slug>/), bounded depth. */
async function findLedgers(root: string, depth = 4): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, d: number) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile() && e.name === 'runs.jsonl') out.push(p);
      else if (e.isDirectory() && d > 0 && e.name !== 'node_modules') await walk(p, d - 1);
    }
  }
  await walk(root, depth);
  return out;
}

/** Merge all ledger records under the root, ascending by ts. */
async function scanRuns(): Promise<{ records: RunRecord[]; ledgers: number }> {
  const ledgers = await findLedgers(ROOT);
  const all: RunRecord[] = [];
  for (const l of ledgers) all.push(...(await readRuns(l).catch(() => [])));
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { records: all, ledgers: ledgers.length };
}

function sendJson(res: ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(s);
}

// --- Control center: launch + track loop runs -----------------------------
const BIN = join(process.env.PROBEVANE_ROOT ?? resolve('.'), 'bin', 'probevane');
const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const DASHBOARD = readFileSync(join(UI_DIR, 'control.html'), 'utf8');

interface Job {
  id: string;
  op: string;
  dir: string;
  flags: string[];
  pid?: number;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  tail: string[]; // last N output lines (for the dashboard)
  proc?: ChildProcess; // runtime handle (not persisted) — for /cancel
}
const jobs = new Map<string, Job>();

/** Persisted snapshot of a job (no runtime handle / capped tail). */
function snapshot(j: Job): Omit<Job, 'proc'> {
  const { proc, ...rest } = j;
  return { ...rest, tail: j.tail.slice(-JOB_TAIL) };
}

/** Append the job's current state; jobs.jsonl is reduced last-wins on load. */
async function persistJob(j: Job) {
  await appendJsonl(JOBS_PATH, snapshot(j)).catch(() => {});
}

/** Rebuild the jobs map from disk on startup (last-wins; orphaned 'running' →
 *  'error') via the pure reducer. */
async function loadJobs() {
  const rows = await readJsonl<PersistedJob>(JOBS_PATH).catch(() => [] as PersistedJob[]);
  for (const j of reduceJobs(rows)) jobs.set(j.id, { ...j, tail: j.tail ?? [] });
}

/** Keep the in-memory map bounded: evict the oldest finished jobs past MAX_JOBS. */
function evictOldJobs() {
  for (const id of jobsToEvict([...jobs.values()], MAX_JOBS)) jobs.delete(id);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > MAX_BODY) req.destroy(); // cap
    });
    req.on('end', () => res(data));
    req.on('error', () => res(data));
  });
}

async function launch(req: IncomingMessage, res: ServerResponse) {
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' });
  }
  const v = validateLaunch(body);
  if (!v.ok) return sendJson(res, 400, { error: v.error });
  const dir = resolve(v.plan.dir);
  if (!(await stat(dir).then((s) => s.isDirectory()).catch(() => false)))
    return sendJson(res, 400, { error: `dir not found: ${dir}` });

  const id = randomUUID().slice(0, 8);
  const job: Job = {
    id,
    op: v.plan.op,
    dir,
    flags: v.plan.flags,
    status: 'running',
    startedAt: new Date().toISOString(),
    tail: [],
  };
  jobs.set(id, job);
  evictOldJobs();
  // No shell — arg array. Child writes its own event log under <dir>/.probevane.
  const child = spawn(BIN, [v.plan.op, dir, ...v.plan.flags], { stdio: ['ignore', 'pipe', 'pipe'] });
  job.pid = child.pid;
  job.proc = child;
  const onOut = (buf: Buffer) =>
    String(buf)
      .split('\n')
      .filter(Boolean)
      .forEach((l) => {
        job.tail.push(l);
        if (job.tail.length > JOB_TAIL) job.tail.shift();
      });
  child.stdout.on('data', onOut);
  child.stderr.on('data', onOut);
  child.on('close', (code) => {
    if (job.status !== 'cancelled') job.status = code === 0 ? 'done' : 'error';
    job.exitCode = code ?? 1;
    job.endedAt = new Date().toISOString();
    job.proc = undefined;
    void log('info', 'job_done', { id, op: job.op, status: job.status, exitCode: job.exitCode });
    void persistJob(job);
  });
  await log('info', 'job_start', { id, op: job.op, dir, flags: job.flags });
  await persistJob(job);
  return sendJson(res, 200, { id, status: job.status });
}

/** Cancel a running job by killing its child process. */
function cancelJob(id: string, res: ServerResponse) {
  const job = jobs.get(id);
  if (!job) return sendJson(res, 404, { error: `no job ${id}` });
  if (job.status !== 'running' || !job.proc) return sendJson(res, 409, { error: `job ${id} not running` });
  job.status = 'cancelled';
  job.proc.kill('SIGTERM');
  void log('info', 'job_cancel', { id, op: job.op });
  return sendJson(res, 200, { id, status: 'cancelled' });
}

// --- supervisor + queue (Pillar B) — the daemon pulls work + dispatches -----
const QUEUE_PATH = join(ROOT, 'queue.jsonl');
const QUEUE_ON = process.env.PROBEVANE_QUEUE === '1';
const SHIP_ON = process.env.PROBEVANE_SHIP === '1';
const QUEUE_TICK = Number(process.env.PROBEVANE_QUEUE_TICK ?? 2) * 1000;
// Safety rails (Pillar C).
const BUDGET_CAP = Number(process.env.PROBEVANE_BUDGET_CAP ?? 0); // USD over the window; 0 = no cap
const BUDGET_WINDOW = Number(process.env.PROBEVANE_BUDGET_WINDOW ?? 24); // hours
const QUARANTINE = Number(process.env.PROBEVANE_QUARANTINE ?? 3); // re-queue with backoff up to N attempts, then quarantine
const HALT_ON_ALERT = process.env.PROBEVANE_HALT_ON_ALERT === '1';
let queue: QueueItem[] = [];
let supervising = false; // one in-flight dispatch at a time
let paused = false; // safety: set by Pillar C alert-halt / budget cap

async function loadQueue() {
  queue = reduceQueue(await readJsonl<QueueItem>(QUEUE_PATH).catch(() => []));
}
async function persistItem(item: QueueItem) {
  const i = queue.findIndex((q) => q.id === item.id);
  if (i >= 0) queue[i] = item;
  else queue.push(item);
  await appendJsonl(QUEUE_PATH, item).catch(() => {});
}

/** Dispatch one queued item: spawn the op, mark it, ship on accept. */
async function dispatch(item: QueueItem) {
  await persistItem(mark(item, 'running'));
  await log('info', 'queue_run', { id: item.id, op: item.op, dir: item.dir });
  const code: number = await new Promise((res) => {
    const child = spawn(BIN, [item.op, item.dir, ...item.flags], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('close', (c) => res(c ?? 1));
    child.on('error', () => res(1));
  });
  const accepted = code === 0;
  const ran = queue.find((q) => q.id === item.id)!; // has the bumped attempts
  if (accepted) {
    await persistItem(mark(ran, 'done', { exitCode: code, endedAt: new Date().toISOString() }));
  } else if (ran.attempts < QUARANTINE) {
    // Re-queue with exponential backoff (cross-run recovery).
    const nextAt = Date.now() + backoffMs(ran.attempts);
    await persistItem(mark(ran, 'queued', { exitCode: code, nextAt }));
    await log('info', 'queue_retry', { id: item.id, attempts: ran.attempts, backoffMs: backoffMs(ran.attempts) });
  } else {
    // Quarantine: stop retrying a poisoned target.
    await persistItem(mark(ran, 'error', { exitCode: code, endedAt: new Date().toISOString() }));
    await log('error', 'queue_quarantine', { id: item.id, attempts: ran.attempts });
  }
  await log(accepted ? 'info' : 'error', 'queue_done', { id: item.id, exitCode: code });
  if (accepted && SHIP_ON) {
    const diary = await latestDiary(item.dir);
    if (diary) {
      const r = await shipRun(item.dir, diary, { op: item.op, repo: item.dir }, (l) => void log('info', 'ship', { line: l })).catch(() => null);
      await log('info', 'queue_ship', { id: item.id, shipped: !!r?.shipped, pr: r?.prUrl });
    }
  }
}

/** Supervisor tick: pull the next ready item and run it (one at a time). */
async function supervise() {
  if (!QUEUE_ON || supervising || paused) return;
  // Global budget ceiling: over the cap → pause the line (keep serving).
  if (BUDGET_CAP > 0) {
    const { records } = await scanRuns();
    if (overCap(records, BUDGET_CAP, BUDGET_WINDOW, Date.now())) {
      paused = true;
      await log('error', 'budget_halt', { capUsd: BUDGET_CAP, windowHrs: BUDGET_WINDOW });
      return;
    }
  }
  await loadQueue(); // pick up items enqueued externally (CLI / other writers)
  const item = nextReady(queue, Date.now());
  if (!item) return;
  supervising = true;
  try {
    await dispatch(item);
  } catch (e: any) {
    await log('error', 'supervise_error', { error: String(e?.message ?? e) });
  } finally {
    supervising = false;
  }
}

// SSE tail of a launched run's event log (<dir>/.probevane/events-*.jsonl).
async function streamEvents(dir: string, res: ServerResponse, req: IncomingMessage) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  const evDir = join(resolve(dir), '.probevane');
  const offsets = new Map<string, number>();
  let alive = true;
  req.on('close', () => (alive = false));
  while (alive) {
    const files = (await readdir(evDir).catch(() => [])).filter((f) => /^events-.*\.jsonl$/.test(f));
    for (const f of files.sort()) {
      const p = join(evDir, f);
      const content = await readFile(p, 'utf8').catch(() => '');
      const { lines, offset } = tailFrom(content, offsets.get(p) ?? 0);
      offsets.set(p, offset);
      for (const ln of lines) res.write(sseFrame(ln));
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const full = req.url ?? '/';
  const url = full.split('?')[0];
  const query = new URLSearchParams(full.split('?')[1] ?? '');
  try {
    if (req.method === 'POST' && url === '/run') return launch(req, res);
    if (req.method === 'POST' && url === '/cancel') {
      const id = query.get('id');
      if (!id) return sendJson(res, 400, { error: 'id query param required' });
      return cancelJob(id, res);
    }
    if (req.method === 'POST' && url === '/enqueue') {
      let body: unknown;
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
      const v = validateLaunch(body);
      if (!v.ok) return sendJson(res, 400, { error: v.error });
      const item = newItem(randomUUID().slice(0, 8), v.plan.op, resolve(v.plan.dir), v.plan.flags, new Date().toISOString());
      await persistItem(item);
      await log('info', 'enqueue', { id: item.id, op: item.op, dir: item.dir });
      return sendJson(res, 200, { id: item.id, status: 'queued' });
    }
    if (url === '/queue') return sendJson(res, 200, { paused, summary: queueSummary(queue), items: queue.slice(-100) });
    if (url === '/jobs') {
      // snapshot() drops the ChildProcess handle (not serializable) + caps the tail.
      return sendJson(res, 200, {
        jobs: [...jobs.values()].map((j) => ({ ...snapshot(j), tail: j.tail.slice(-JOBS_RETURN) })),
      });
    }
    if (url === '/stream') {
      const dir = query.get('dir');
      if (!dir) return sendJson(res, 400, { error: 'dir query param required' });
      return streamEvents(dir, res, req);
    }
    if (url === '/quality') {
      const dir = query.get('dir');
      if (!dir) return sendJson(res, 400, { error: 'dir query param required' });
      return sendJson(res, 200, await scanProject(resolve(dir)));
    }
    if (url === '/ops') {
      const { LAUNCH_OPS } = await import('../observe/launch.js');
      return sendJson(res, 200, { ops: LAUNCH_OPS });
    }
    if (url === '/health') {
      const { ledgers } = await scanRuns();
      return sendJson(res, 200, {
        ok: true,
        version: VERSION,
        pid: process.pid,
        uptimeSec: Math.round((Date.now() - STARTED) / 1000),
        stateRoot: ROOT,
        ledgers,
        queue: QUEUE_ON ? queueSummary(queue) : undefined,
        paused,
      });
    }
    if (url === '/aggregate') {
      const { records } = await scanRuns();
      return sendJson(res, 200, aggregateOverTime(records));
    }
    if (url === '/alerts') {
      const { records } = await scanRuns();
      const { daily } = aggregateOverTime(records);
      return sendJson(res, 200, { alerts: computeAlerts(daily, alertOpts), opts: alertOpts });
    }
    if (url === '/audit') {
      const entries = await readAudit();
      return sendJson(res, 200, { count: entries.length, entries: entries.slice(-AUDIT_RETURN) });
    }
    if (url === '/metrics') {
      const { records } = await scanRuns(); // Prometheus scrape over the whole fleet
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      return res.end(prometheusText(records));
    }
    if (url === '/otel/traces') {
      const { records } = await scanRuns();
      return sendJson(res, 200, tracesPayload(records));
    }
    if (url === '/otel/metrics') {
      const { records } = await scanRuns();
      return sendJson(res, 200, metricsPayload(records, new Date().toISOString()));
    }
    if (url === '/' || url === '/index') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(DASHBOARD);
    }
    return sendJson(res, 404, { error: `no route ${url}` });
  } catch (e: any) {
    await log('error', 'request_error', { url, error: String(e?.message ?? e) });
    return sendJson(res, 500, { error: String(e?.message ?? e) });
  }
}

const server = createServer((req, res) => {
  const t0 = Date.now();
  res.on('finish', () =>
    log('info', 'request', { method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - t0 }),
  );
  void handle(req, res);
});

// Periodic alert evaluation → structured log (so alerts are recorded even with no
// client polling /alerts; an external notifier can tail daemon.log.jsonl).
let timer: NodeJS.Timeout | undefined;
const WEBHOOK = process.env.PROBEVANE_ALERT_WEBHOOK; // POST new alerts here (Slack-compatible)
const sentAlerts = new Set<string>(); // dedup across intervals — post each alert once
async function evalAlerts() {
  const { records, ledgers } = await scanRuns();
  const { daily } = aggregateOverTime(records);
  const alerts = computeAlerts(daily, alertOpts);
  await log('info', 'scan', { ledgers, runs: records.length, alerts: alerts.length });

  // Circuit-breaker: an error-severity alert halts the line (observability stays up).
  if (HALT_ON_ALERT && !paused && shouldHalt(alerts)) {
    paused = true;
    await log('error', 'alert_halt', { kinds: alerts.filter((a) => a.severity === 'error').map((a) => a.kind) });
  }
  for (const a of alerts) await log(a.severity, `alert.${a.kind}`, { message: a.message, value: a.value, threshold: a.threshold });

  // Push genuinely-new alerts to the external webhook (once each).
  if (WEBHOOK) {
    const fresh = newAlerts(alerts, sentAlerts);
    if (fresh.length) {
      try {
        await fetch(WEBHOOK, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildAlertPayload(fresh)),
        });
        for (const a of fresh) sentAlerts.add(alertKey(a));
        await log('info', 'alert_webhook', { posted: fresh.length });
      } catch (e: any) {
        await log('error', 'alert_webhook_failed', { error: String(e?.message ?? e) });
      }
    }
  }
}

// Supervision: log uncaught errors but keep serving.
process.on('uncaughtException', (e) => void log('error', 'uncaught', { error: String(e?.message ?? e) }));
process.on('unhandledRejection', (e: any) => void log('error', 'unhandled_rejection', { error: String(e?.message ?? e) }));

let shuttingDown = false;
async function shutdown(sig: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearInterval(timer);
  if (queueTimer) clearInterval(queueTimer);
  await log('info', 'shutdown', { signal: sig }); // flush before we close
  server.close(() => process.exit(0));
  // Hard cap so a hung connection can't block exit forever.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

let queueTimer: NodeJS.Timeout | undefined;
server.listen(PORT, '127.0.0.1', async () => {
  await loadJobs(); // restore launched-job history (orphaned 'running' → 'error')
  await loadQueue();
  await log('info', 'listen', { port: PORT, root: ROOT, intervalSec: INTERVAL / 1000, version: VERSION, jobs: jobs.size, queue: QUEUE_ON ? queue.length : undefined });
  console.log(`probevane daemon → http://127.0.0.1:${PORT}  (state: ${ROOT})`);
  console.log(`  /health  /aggregate  /alerts  /audit  /jobs  /queue  /metrics  /otel/{traces,metrics}  (POST /run, /enqueue, /cancel?id=)`);
  if (QUEUE_ON) console.log(`  supervisor ON (tick ${QUEUE_TICK / 1000}s${SHIP_ON ? ', ship' : ''}) — pulls /queue + dispatches`);
  await evalAlerts();
  timer = setInterval(() => void evalAlerts(), INTERVAL);
  if (QUEUE_ON) queueTimer = setInterval(() => void supervise(), QUEUE_TICK);
});
