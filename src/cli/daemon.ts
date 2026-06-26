import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { stateRoot } from '../util/state.js';
import { readRuns, type RunRecord } from '../cost/ledger.js';
import { appendJsonl } from '../util/jsonl.js';
import { aggregateOverTime } from '../observe/aggregate.js';
import { computeAlerts, DEFAULT_ALERT_OPTS } from '../observe/alerts.js';
import { readAudit } from '../observe/audit.js';

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

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = (req.url ?? '/').split('?')[0];
  try {
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
      return sendJson(res, 200, {
        service: 'probevane daemon',
        version: VERSION,
        endpoints: ['/health', '/aggregate', '/alerts', '/audit'],
      });
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
