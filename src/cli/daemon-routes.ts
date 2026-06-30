import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RunRecord } from '../cost/ledger.js';
import { aggregateOverTime } from '../observe/aggregate.js';
import { computeAlerts } from '../observe/alerts.js';
import { readAudit } from '../observe/audit.js';
import { tracesPayload, metricsPayload, prometheusText } from '../observe/otel.js';
import { queueSummary } from '../observe/queue.js';
import { scanProject } from '../quality/scan.js';
import { jobs, getQueue, isPaused, snapshot, launch, cancelJob, enqueue, streamEvents } from './daemon-control.js';

// HTTP router for the daemon. Split out of daemon.ts so each file stays under the
// project quality bar. daemon.ts injects its observability deps via initRoutes().

export interface RouteCtx {
  VERSION: string;
  STARTED: number;
  ROOT: string;
  QUEUE_ON: boolean;
  JOBS_RETURN: number;
  AUDIT_RETURN: number;
  DASHBOARD: string;
  alertOpts: Parameters<typeof computeAlerts>[1];
  log: (level: string, event: string, data?: Record<string, unknown>) => Promise<void>;
  sendJson: (res: ServerResponse, code: number, body: unknown) => void;
  scanRuns: () => Promise<{ records: RunRecord[]; ledgers: number }>;
}

let CTX: RouteCtx;
export function initRoutes(ctx: RouteCtx): void {
  CTX = ctx;
}

/** POST routes; returns true if it handled the request (else fall through to GET). */
async function handlePost(
  url: string,
  query: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (url === '/run') {
    await launch(req, res);
    return true;
  }
  if (url === '/cancel') {
    const id = query.get('id');
    if (!id) CTX.sendJson(res, 400, { error: 'id query param required' });
    else cancelJob(id, res);
    return true;
  }
  if (url === '/enqueue') {
    await enqueue(req, res);
    return true;
  }
  return false;
}

/** Scan-backed GET routes (cost/observability over the whole fleet). */
async function handleMetrics(url: string, res: ServerResponse): Promise<void> {
  if (url === '/health') {
    const { ledgers } = await CTX.scanRuns();
    return CTX.sendJson(res, 200, {
      ok: true,
      version: CTX.VERSION,
      pid: process.pid,
      uptimeSec: Math.round((Date.now() - CTX.STARTED) / 1000),
      stateRoot: CTX.ROOT,
      ledgers,
      queue: CTX.QUEUE_ON ? queueSummary(getQueue()) : undefined,
      paused: isPaused(),
    });
  }
  if (url === '/aggregate') {
    const { records } = await CTX.scanRuns();
    return CTX.sendJson(res, 200, aggregateOverTime(records));
  }
  if (url === '/alerts') {
    const { records } = await CTX.scanRuns();
    const { daily } = aggregateOverTime(records);
    return CTX.sendJson(res, 200, { alerts: computeAlerts(daily, CTX.alertOpts), opts: CTX.alertOpts });
  }
  if (url === '/metrics') {
    const { records } = await CTX.scanRuns(); // Prometheus scrape over the whole fleet
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(prometheusText(records));
    return;
  }
  if (url === '/otel/traces') {
    const { records } = await CTX.scanRuns();
    return CTX.sendJson(res, 200, tracesPayload(records));
  }
  if (url === '/otel/metrics') {
    const { records } = await CTX.scanRuns();
    return CTX.sendJson(res, 200, metricsPayload(records, new Date().toISOString()));
  }
  return CTX.sendJson(res, 404, { error: `no route ${url}` });
}

/** GET routes. */
async function handleGet(
  url: string,
  query: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (url === '/queue')
    return CTX.sendJson(res, 200, {
      paused: isPaused(),
      summary: queueSummary(getQueue()),
      items: getQueue().slice(-100),
    });
  if (url === '/jobs') {
    // snapshot() drops the ChildProcess handle (not serializable) + caps the tail.
    return CTX.sendJson(res, 200, {
      jobs: [...jobs.values()].map((j) => ({ ...snapshot(j), tail: j.tail.slice(-CTX.JOBS_RETURN) })),
    });
  }
  if (url === '/stream') {
    const dir = query.get('dir');
    if (!dir) return CTX.sendJson(res, 400, { error: 'dir query param required' });
    return streamEvents(dir, res, req);
  }
  if (url === '/quality') {
    const dir = query.get('dir');
    if (!dir) return CTX.sendJson(res, 400, { error: 'dir query param required' });
    return CTX.sendJson(res, 200, await scanProject(resolve(dir)));
  }
  if (url === '/ops') {
    const { LAUNCH_OPS } = await import('../observe/launch.js');
    return CTX.sendJson(res, 200, { ops: LAUNCH_OPS });
  }
  if (url === '/audit') {
    const entries = await readAudit();
    return CTX.sendJson(res, 200, { count: entries.length, entries: entries.slice(-CTX.AUDIT_RETURN) });
  }
  if (url === '/' || url === '/index') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(CTX.DASHBOARD);
    return;
  }
  return handleMetrics(url, res);
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const full = req.url ?? '/';
  const url = full.split('?')[0];
  const query = new URLSearchParams(full.split('?')[1] ?? '');
  try {
    if (req.method === 'POST') {
      const posted = await handlePost(url, query, req, res);
      if (posted) return;
    }
    return await handleGet(url, query, req, res);
  } catch (e: any) {
    await CTX.log('error', 'request_error', { url, error: String(e?.message ?? e) });
    return CTX.sendJson(res, 500, { error: String(e?.message ?? e) });
  }
}
