import { resolve, join, basename } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RunRecord } from '../cost/ledger.js';
import { aggregateOverTime } from '../observe/aggregate.js';
import { computeAlerts } from '../observe/alerts.js';
import { readAudit } from '../observe/audit.js';
import { tracesPayload, metricsPayload, prometheusText } from '../observe/otel.js';
import { queueSummary } from '../observe/queue.js';
import { buildProjects } from '../observe/projects.js';
import { pageRuns, mergeRun } from '../observe/run-detail.js';
import { parseEvents } from '../loop/events.js';
import { parseTranscript } from '../loop/transcript.js';
import { scanProject } from '../quality/scan.js';
import { jobs, getQueue, isPaused, snapshot, launch, cancelJob, enqueue, streamEvents, streamFiles, readBody } from './daemon-control.js';
import { handleTerm } from './terminal-routes.js';

// A runId / wiki filename is safe to interpolate into a path only if it has no
// separators or traversal — defense in depth atop the 127.0.0.1 binding.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
/** Resolve <dir>/.probevane/<file> and assert it stays under that dir; null if unsafe. */
function probevaneFile(dir: string, file: string): string | null {
  if (!SAFE_ID.test(file)) return null;
  const base = join(resolve(dir), '.probevane');
  const p = join(base, file);
  return p.startsWith(base) ? p : null;
}

// HTTP router for the daemon. Split out of daemon.ts so each file stays under the
// project quality bar. daemon.ts injects its observability deps via initRoutes().

export interface RouteCtx {
  VERSION: string;
  STARTED: number;
  ROOT: string;
  QUEUE_ON: boolean;
  JOBS_RETURN: number;
  AUDIT_RETURN: number;
  // Getter — under PROBEVANE_UI_DEV recompiles the TSX sources per request
  // (runtime compiler; the design loop sees its edits live), else cached html.
  DASHBOARD: () => string | Promise<string>;
  WIKI_DIR: string;
  alertOpts: Parameters<typeof computeAlerts>[1];
  log: (level: string, event: string, data?: Record<string, unknown>) => Promise<void>;
  sendJson: (res: ServerResponse, code: number, body: unknown) => void;
  scanRuns: () => Promise<{ records: RunRecord[]; ledgers: number }>;
}

let CTX: RouteCtx;
/** Wire daemon.ts's config + observability deps in once at startup. */
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
  if (url === '/assistant/interpret') {
    // NL request → a confirmable launch plan (deterministic, $0). The actual run
    // is launched separately via POST /run with the returned launch body.
    const { interpret } = await import('./assistant.js');
    const raw = (await readBody(req, 64 * 1024)) || '{}';
    const body = JSON.parse(raw) as { dir?: string; prompt?: string; model?: string };
    CTX.sendJson(res, 200, await interpret(body.dir ?? '.', body.prompt ?? '', body.model));
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

/** Control-center run/project data + folded-in wiki. Returns true if handled. */
async function handleData(
  url: string,
  query: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (url === '/projects') {
    const files = (await readdir(CTX.WIKI_DIR).catch(() => [])).filter((f) => /^project-.*\.md$/.test(f));
    const { records } = await CTX.scanRuns();
    CTX.sendJson(res, 200, { projects: buildProjects(files, records) });
    return true;
  }
  if (url === '/runs') {
    const { records } = await CTX.scanRuns();
    CTX.sendJson(res, 200, pageRuns(records, Number(query.get('limit') ?? 50), Number(query.get('offset') ?? 0)));
    return true;
  }
  if (url === '/run') return handleRun(query, res);
  if (url === '/transcript') return handleTranscript(query, req, res);
  if (url === '/wiki') {
    const files = (await readdir(CTX.WIKI_DIR).catch(() => [])).filter((f) => f.endsWith('.md'));
    CTX.sendJson(res, 200, {
      core: files.filter((f) => !/^project-/.test(f)).sort(),
      projects: files.filter((f) => /^project-/.test(f)).sort(),
    });
    return true;
  }
  if (url.startsWith('/wiki/raw/')) return handleWikiRaw(url, res);
  return handleConsoleData(url, query, res);
}

/** Console-tab data: rune pipeline + module constellation. Returns true if handled. */
async function handleConsoleData(url: string, query: URLSearchParams, res: ServerResponse): Promise<boolean> {
  if (url === '/pipeline') {
    // Rune pipeline for the console's live node graph — always derived from
    // the real profiles (describePipeline), never a stale committed model.
    const { describePipeline } = await import('../loop/describe.js');
    const profile = (query.get('profile') ?? 'write_tests') as Parameters<typeof describePipeline>[0];
    try {
      CTX.sendJson(res, 200, describePipeline(profile, { kind: 'unit' }));
    } catch {
      CTX.sendJson(res, 400, { error: `unknown profile ${String(profile)}` });
    }
    return true;
  }
  if (url === '/events') {
    // Theater replay: a run's durable event stream from the state root
    // (survives workdir deletion — the whole point).
    const runId = query.get('runId');
    if (!runId || !SAFE_ID.test(runId)) { CTX.sendJson(res, 400, { error: 'valid runId required' }); return true; }
    const { statePath } = await import('../util/state.js');
    const txt =
      (await readFile(statePath('events', `${runId}.jsonl`), 'utf8').catch(() => null)) ??
      (await readFile(join(CTX.ROOT, 'events', `${runId}.jsonl`), 'utf8').catch(() => null));
    if (txt === null) { CTX.sendJson(res, 404, { error: 'no captured events for this run' }); return true; }
    CTX.sendJson(res, 200, { runId, events: parseEvents(txt) });
    return true;
  }
  if (url === '/graph') {
    // Module constellation: dependency graph + fan-in per node.
    const dir = query.get('dir') ?? process.env.PROBEVANE_ROOT ?? '.';
    const { buildGraph } = await import('../mock/graph.js');
    const g = await buildGraph(resolve(dir));
    const fanIn = new Map<string, number>();
    for (const n of g.nodes.values()) for (const dep of n.imports) fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
    CTX.sendJson(res, 200, {
      nodes: [...g.nodes.values()].map((n) => ({ ...n, fanIn: fanIn.get(n.path) ?? 0 })),
      order: g.order,
    });
    return true;
  }
  return false;
}

/** GET /run?dir&runId — merge ledger record + diary + events summary. */
async function handleRun(query: URLSearchParams, res: ServerResponse): Promise<boolean> {
  const dir = query.get('dir');
  const runId = query.get('runId');
  if (!dir || !runId) { CTX.sendJson(res, 400, { error: 'dir + runId query params required' }); return true; }
  if (!SAFE_ID.test(runId)) { CTX.sendJson(res, 400, { error: 'invalid runId' }); return true; }
  const record = (await CTX.scanRuns()).records.find((r) => r.runId === runId);
  const dPath = join(resolve(dir), '.probevane', 'diary', `${runId}.json`); // runId guarded above
  const diary = await readFile(dPath, 'utf8').then((t) => JSON.parse(t)).catch(() => undefined);
  const evPath = probevaneFile(dir, `events-${runId}.jsonl`);
  const events = evPath ? parseEvents(await readFile(evPath, 'utf8').catch(() => '')) : [];
  CTX.sendJson(res, 200, mergeRun(runId, record, diary, events));
  return true;
}

/** GET /transcript?dir&runId[&follow=1] — full transcript JSON, or SSE file-tail. */
async function handleTranscript(query: URLSearchParams, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const dir = query.get('dir');
  const runId = query.get('runId');
  if (!dir || !runId || !SAFE_ID.test(runId)) { CTX.sendJson(res, 400, { error: 'valid dir + runId required' }); return true; }
  if (query.get('follow') === '1') { await streamFiles(dir, new RegExp(`^transcript-${runId}\\.jsonl$`), res, req); return true; }
  const tPath = probevaneFile(dir, `transcript-${runId}.jsonl`);
  const turns = tPath ? parseTranscript(await readFile(tPath, 'utf8').catch(() => '')) : [];
  CTX.sendJson(res, 200, { runId, turns });
  return true;
}

/** GET /wiki/raw/<file>.md — raw markdown for client-side render (path-guarded). */
async function handleWikiRaw(url: string, res: ServerResponse): Promise<boolean> {
  const file = basename(url.slice('/wiki/raw/'.length));
  if (!SAFE_ID.test(file) || !file.endsWith('.md')) { CTX.sendJson(res, 400, { error: 'invalid wiki file' }); return true; }
  const md = await readFile(join(CTX.WIKI_DIR, file), 'utf8').catch(() => null);
  if (md === null) { CTX.sendJson(res, 404, { error: 'not found' }); return true; }
  res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
  res.end(md);
  return true;
}

/** The analysis GETs (/quality scan, /checks gate scoreboard) — split from
 *  handleGet to keep the dispatcher under the complexity bar. True = handled. */
async function handleAnalysis(url: string, query: URLSearchParams, res: ServerResponse): Promise<boolean> {
  if (url === '/quality') {
    const dir = query.get('dir');
    if (!dir) CTX.sendJson(res, 400, { error: 'dir query param required' });
    else CTX.sendJson(res, 200, await scanProject(resolve(dir)));
    return true;
  }
  if (url === '/checks') {
    // Gate scoreboard for the Checks tab: cheap gates run live, heavy ones read
    // from artifacts. Defaults to the daemon's own cwd (the repo it serves).
    const { collectChecks } = await import('./checks.js');
    CTX.sendJson(res, 200, await collectChecks(query.get('dir') ?? '.'));
    return true;
  }
  if (url === '/assistant/propose') {
    // Post-run $0 improvement follow-ups for the Chat tab.
    const { propose } = await import('./assistant.js');
    CTX.sendJson(res, 200, { proposals: await propose(query.get('dir') ?? '.') });
    return true;
  }
  return false;
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
  if (await handleAnalysis(url, query, res)) return;
  if (url === '/ops') {
    const { LAUNCH_OPS } = await import('../observe/launch.js');
    return CTX.sendJson(res, 200, { ops: LAUNCH_OPS });
  }
  if (url === '/audit') {
    const entries = await readAudit();
    return CTX.sendJson(res, 200, { count: entries.length, entries: entries.slice(-CTX.AUDIT_RETURN) });
  }
  if (await handleData(url, query, req, res)) return;
  if (url === '/' || url === '/index') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await CTX.DASHBOARD());
    return;
  }
  return handleMetrics(url, res);
}

/** Single entry for every daemon request: /term/* → POST → GET, with one catch-all 500. */
export async function handle(req: IncomingMessage, res: ServerResponse) {
  const full = req.url ?? '/';
  const url = full.split('?')[0];
  const query = new URLSearchParams(full.split('?')[1] ?? '');
  try {
    if (url.startsWith('/term/')) { await handleTerm(url, query, req, res); return; }
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
