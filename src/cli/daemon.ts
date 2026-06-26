import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stateRoot } from '../util/state.js';
import { readRuns, type RunRecord } from '../cost/ledger.js';
import { appendJsonl } from '../util/jsonl.js';
import { aggregateOverTime } from '../observe/aggregate.js';
import { computeAlerts, DEFAULT_ALERT_OPTS } from '../observe/alerts.js';
import { readAudit } from '../observe/audit.js';
import { validateLaunch } from '../observe/launch.js';
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
const STARTED = Date.now();
const VERSION = await pkgVersion();

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

/** Structured log line — to the daemon log (atomic) and stderr. */
async function log(level: string, event: string, data: Record<string, unknown> = {}) {
  const line = { ts: new Date().toISOString(), level, event, ...data };
  console.error(`[daemon] ${event} ${JSON.stringify(data)}`);
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
  status: 'running' | 'done' | 'error';
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  tail: string[]; // last N output lines (for the dashboard)
}
const jobs = new Map<string, Job>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy(); // cap
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
  // No shell — arg array. Child writes its own event log under <dir>/.probevane.
  const child = spawn(BIN, [v.plan.op, dir, ...v.plan.flags], { stdio: ['ignore', 'pipe', 'pipe'] });
  job.pid = child.pid;
  const onOut = (buf: Buffer) =>
    String(buf)
      .split('\n')
      .filter(Boolean)
      .forEach((l) => {
        job.tail.push(l);
        if (job.tail.length > 200) job.tail.shift();
      });
  child.stdout.on('data', onOut);
  child.stderr.on('data', onOut);
  child.on('close', (code) => {
    job.status = code === 0 ? 'done' : 'error';
    job.exitCode = code ?? 1;
    job.endedAt = new Date().toISOString();
    void log('info', 'job_done', { id, op: job.op, status: job.status, exitCode: job.exitCode });
  });
  await log('info', 'job_start', { id, op: job.op, dir, flags: job.flags });
  return sendJson(res, 200, { id, status: job.status });
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
    if (url === '/jobs') {
      return sendJson(res, 200, {
        jobs: [...jobs.values()].map((j) => ({ ...j, tail: j.tail.slice(-40) })),
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
      return sendJson(res, 200, { count: entries.length, entries: entries.slice(-200) });
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
async function evalAlerts() {
  const { records, ledgers } = await scanRuns();
  const { daily } = aggregateOverTime(records);
  const alerts = computeAlerts(daily, alertOpts);
  await log('info', 'scan', { ledgers, runs: records.length, alerts: alerts.length });
  for (const a of alerts) await log(a.severity, `alert.${a.kind}`, { message: a.message, value: a.value, threshold: a.threshold });
}

// Supervision: log uncaught errors but keep serving.
process.on('uncaughtException', (e) => void log('error', 'uncaught', { error: String(e?.message ?? e) }));
process.on('unhandledRejection', (e: any) => void log('error', 'unhandled_rejection', { error: String(e?.message ?? e) }));

let shuttingDown = false;
async function shutdown(sig: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearInterval(timer);
  await log('info', 'shutdown', { signal: sig }); // flush before we close
  server.close(() => process.exit(0));
  // Hard cap so a hung connection can't block exit forever.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

server.listen(PORT, '127.0.0.1', async () => {
  await log('info', 'listen', { port: PORT, root: ROOT, intervalSec: INTERVAL / 1000, version: VERSION });
  console.log(`probevane daemon → http://127.0.0.1:${PORT}  (state: ${ROOT})`);
  console.log(`  /health  /aggregate  /alerts  /audit`);
  await evalAlerts();
  timer = setInterval(() => void evalAlerts(), INTERVAL);
});
