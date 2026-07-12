import { createServer, type ServerResponse } from 'node:http';
import { readdir, readFile, stat, rename } from 'node:fs/promises';
import { readFileSync, type Dirent } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stateRoot } from '../util/state.js';
import { readRuns, type RunRecord } from '../cost/ledger.js';
import { appendJsonl } from '../util/jsonl.js';
import { aggregateOverTime } from '../observe/aggregate.js';
import { computeAlerts, shouldHalt, DEFAULT_ALERT_OPTS } from '../observe/alerts.js';
import { buildAlertPayload, newAlerts, alertKey } from '../observe/notify.js';
import { initControl, jobs, getQueue, isPaused, setPaused, loadJobs, loadQueue, supervise } from '../server/daemon-control.js';
import { initRoutes, handle } from '../server/daemon-routes.js';
import { initTerminal, reapIdle, reap, sessions } from '../server/terminal.js';
import { initTermRoutes } from '../server/terminal-routes.js';
import { flag } from '../util/args.js';

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

const PORT = Number(flag(args, '--port') ?? process.env.PROBEVANE_DAEMON_PORT ?? 7766);
const ROOT = resolve(flag(args, '--root') ?? stateRoot());
const INTERVAL = Number(flag(args, '--interval') ?? 60) * 1000;
const LOG_PATH = join(ROOT, 'daemon.log.jsonl'); // self-contained under the scanned root
const JOBS_PATH = join(ROOT, 'jobs.jsonl'); // persisted launched-job history (restart-safe)
const QUEUE_PATH = join(ROOT, 'queue.jsonl');
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

/** A directory worth descending during the ledger walk (not node_modules, depth left). */
function isWalkableDir(e: Dirent, d: number): boolean {
  return e.isDirectory() && d > 0 && e.name !== 'node_modules';
}

/** Find every runs.jsonl under `root` (global + factory/<run>/<slug>/), bounded depth. */
async function findLedgers(root: string, depth = 4): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, d: number) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile() && e.name === 'runs.jsonl') { out.push(p); continue; }
      if (isWalkableDir(e, d)) await walk(p, d - 1);
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

// --- Control center + router wiring ----------------------------------------
const BIN = join(process.env.PROBEVANE_ROOT ?? resolve('.'), 'bin', 'probevane');
const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const UI_FILE = join(UI_DIR, 'control.html');
// Cached at startup; PROBEVANE_UI_DEV recompiles the TSX sources per request
// (runtime compiler: edit a component, refresh, see it — no rebuild step, no
// daemon restart). Falls back to re-reading the generated control.html when
// the build module isn't available (published installs don't ship scripts/).
const cachedDashboard = readFileSync(UI_FILE, 'utf8');
const DASHBOARD: () => string | Promise<string> = process.env.PROBEVANE_UI_DEV
  ? await import(pathToFileURL(join(process.env.PROBEVANE_ROOT ?? resolve('.'), 'scripts', 'build-ui.mjs')).href)
      .then((m) => m.buildControlHtml as () => Promise<string>)
      .catch(() => () => readFileSync(UI_FILE, 'utf8'))
  : () => cachedDashboard;
const WIKI_DIR = join(process.env.PROBEVANE_ROOT ?? resolve('.'), 'docs', 'wiki');

// supervisor + queue (Pillar B/C) config — passed into the control module.
const QUEUE_ON = process.env.PROBEVANE_QUEUE === '1';
const SHIP_ON = process.env.PROBEVANE_SHIP === '1';
const QUEUE_TICK = Number(process.env.PROBEVANE_QUEUE_TICK ?? 2) * 1000;
const BUDGET_CAP = Number(process.env.PROBEVANE_BUDGET_CAP ?? 0); // USD over the window; 0 = no cap
const BUDGET_WINDOW = Number(process.env.PROBEVANE_BUDGET_WINDOW ?? 24); // hours
const QUARANTINE = Number(process.env.PROBEVANE_QUARANTINE ?? 3); // re-queue with backoff up to N attempts
const HALT_ON_ALERT = process.env.PROBEVANE_HALT_ON_ALERT === '1';

// Terminal tab (opt-in — it's a shell, bypasses the launch allowlist). Off by
// default; PROBEVANE_TERMINAL=1 arms the /term/* routes (loopback bind is the
// only auth). PTY via the stdlib python3 bridge (no node-pty native dep).
const TERMINAL_ON = process.env.PROBEVANE_TERMINAL === '1';
const PROBE_ROOT = process.env.PROBEVANE_ROOT ?? resolve('.');
const TERM_MAX_SESSIONS = Number(process.env.PROBEVANE_TERM_SESSIONS ?? 4);
const TERM_RING = Number(process.env.PROBEVANE_TERM_RING ?? 512 * 1024);
const TERM_IDLE_MS = Number(process.env.PROBEVANE_TERM_IDLE_MIN ?? 30) * 60 * 1000;

initControl({
  BIN, JOBS_PATH, QUEUE_PATH, JOB_TAIL, MAX_JOBS, MAX_BODY, QUEUE_ON, SHIP_ON, QUARANTINE,
  BUDGET_CAP, BUDGET_WINDOW, log, sendJson, scanRuns,
});
initRoutes({
  VERSION, STARTED, ROOT, QUEUE_ON, JOBS_RETURN, AUDIT_RETURN, DASHBOARD, WIKI_DIR, alertOpts, log, sendJson, scanRuns,
});
initTerminal({
  BRIDGE: join(PROBE_ROOT, 'scripts', 'pty-bridge.py'),
  PYTHON: process.env.PROBEVANE_PY ?? 'python3',
  DEFAULT_CWD: PROBE_ROOT,
  MAX_SESSIONS: TERM_MAX_SESSIONS, RING_BYTES: TERM_RING, log,
});
initTermRoutes({ sendJson, MAX_BODY, DEFAULT_CWD: PROBE_ROOT });
const termReaper = TERMINAL_ON
  ? setInterval(() => { for (const id of reapIdle(Date.now(), TERM_IDLE_MS)) reap(id); }, 60_000)
  : null;

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
  if (HALT_ON_ALERT && !isPaused() && shouldHalt(alerts)) {
    setPaused(true);
    await log('error', 'alert_halt', { kinds: alerts.filter((a) => a.severity === 'error').map((a) => a.kind) });
  }
  for (const a of alerts)
    await log(a.severity, `alert.${a.kind}`, { message: a.message, value: a.value, threshold: a.threshold });

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
process.on('unhandledRejection', (e: any) =>
  void log('error', 'unhandled_rejection', { error: String(e?.message ?? e) }),
);

let shuttingDown = false;
async function shutdown(sig: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearInterval(timer);
  if (queueTimer) clearInterval(queueTimer);
  if (termReaper) clearInterval(termReaper);
  for (const s of sessions.values()) s.proc.kill('SIGTERM'); // don't orphan PTYs
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
  await log('info', 'listen', {
    port: PORT,
    root: ROOT,
    intervalSec: INTERVAL / 1000,
    version: VERSION,
    jobs: jobs.size,
    queue: QUEUE_ON ? getQueue().length : undefined,
  });
  console.log(`probevane daemon → http://127.0.0.1:${PORT}  (state: ${ROOT})`);
  console.log(`  /health  /aggregate  /alerts  /audit  /jobs  /queue  /metrics  /otel/{traces,metrics}  (POST /run, /enqueue, /cancel?id=)`);
  if (QUEUE_ON)
    console.log(`  supervisor ON (tick ${QUEUE_TICK / 1000}s${SHIP_ON ? ', ship' : ''}) — pulls /queue + dispatches`);
  if (TERMINAL_ON)
    console.log(`  TERMINAL tab ON — /term/* live (shell over loopback; ${TERM_MAX_SESSIONS} sessions max)`);
  await evalAlerts();
  timer = setInterval(() => void evalAlerts(), INTERVAL);
  if (QUEUE_ON) queueTimer = setInterval(() => void supervise(), QUEUE_TICK);
});
