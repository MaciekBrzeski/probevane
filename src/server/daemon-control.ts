import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RunRecord } from '../cost/ledger.js';
import { appendJsonl, readJsonl } from '../util/jsonl.js';
import { statePath } from '../util/state.js';
import { backoffMs, isTransientStop } from '../observe/quarantine.js';
import { reduceJobs, jobsToEvict, itemFromPlan, type PersistedJob } from '../observe/jobs.js';
import { reduceQueue, nextReady, mark, type QueueItem } from '../observe/queue.js';
import { validateLaunch } from '../observe/launch.js';
import { overCap } from '../cost/budget.js';
import { shipRun, latestDiary } from '../commands/ship/ship.js';
import { tailFrom, sseFrame } from '../loop/observe.js';

// Control center for the daemon (Pillar B): launch + track loop runs, plus the
// supervisor queue. Split out of daemon.ts so each file/function stays under the
// project's own quality bar. State is module-level (one daemon process); daemon.ts
// wires its config + helpers in via initControl().

export interface Job extends PersistedJob {
  proc?: ChildProcess; // runtime handle (not persisted) — for /cancel
}

/** Daemon config + shared helpers, filled by daemon.ts via initControl() — handlers read this instead of importing daemon.ts back. */
export interface ControlCtx {
  BIN: string;
  JOBS_PATH: string;
  QUEUE_PATH: string;
  JOB_TAIL: number;
  MAX_JOBS: number;
  MAX_BODY: number;
  QUEUE_ON: boolean;
  SHIP_ON: boolean;
  QUARANTINE: number;
  BUDGET_CAP: number;
  BUDGET_WINDOW: number;
  log: (level: string, event: string, data?: Record<string, unknown>) => Promise<void>;
  sendJson: (res: ServerResponse, code: number, body: unknown) => void;
  scanRuns: () => Promise<{ records: RunRecord[]; ledgers: number }>;
}

let CTX: ControlCtx;
export const jobs = new Map<string, Job>();
let queue: QueueItem[] = [];
let paused = false; // safety: set by Pillar C alert-halt / budget cap
let supervising = false; // one in-flight dispatch at a time

/** Wire the daemon's config/helpers in once at startup (module state — one daemon process). */
export function initControl(ctx: ControlCtx): void {
  CTX = ctx;
}

export const getQueue = (): QueueItem[] => queue;
export const isPaused = (): boolean => paused;
/** Flip the supervisor pause flag (Pillar C alert-halt, budget cap, or the pause route). */
export const setPaused = (v: boolean): void => {
  paused = v;
};

/** Persisted snapshot of a job (no runtime handle / capped tail). */
export function snapshot(j: Job): Omit<Job, 'proc'> {
  const { proc, ...rest } = j;
  return { ...rest, tail: j.tail.slice(-CTX.JOB_TAIL) };
}

/** Append the job's current state; jobs.jsonl is reduced last-wins on load. */
async function persistJob(j: Job) {
  await appendJsonl(CTX.JOBS_PATH, snapshot(j)).catch(() => {});
}

/** Rebuild the jobs map from disk on startup (last-wins; orphaned 'running' →
 *  'error') via the pure reducer. */
export async function loadJobs() {
  const rows = await readJsonl<PersistedJob>(CTX.JOBS_PATH).catch(() => [] as PersistedJob[]);
  for (const j of reduceJobs(rows)) jobs.set(j.id, { ...j, tail: j.tail ?? [] });
}

/** Keep the in-memory map bounded: evict the oldest finished jobs past MAX_JOBS. */
function evictOldJobs() {
  for (const id of jobsToEvict([...jobs.values()], CTX.MAX_JOBS)) jobs.delete(id);
}

/** Buffer a request body up to `max` bytes (destroys the socket over cap). */
export function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((res) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > max) req.destroy(); // cap
    });
    req.on('end', () => res(data));
    req.on('error', () => res(data));
  });
}

/** Spawn the child for a launched job and wire its output + lifecycle. */
function startJobProcess(job: Job) {
  // No shell — arg array. Child writes its own event log under <dir>/.probevane.
  const child = spawn(CTX.BIN, [job.op, job.dir, ...job.flags], { stdio: ['ignore', 'pipe', 'pipe'] });
  job.pid = child.pid;
  job.proc = child;
  const onOut = (buf: Buffer) =>
    String(buf)
      .split('\n')
      .filter(Boolean)
      .forEach((l) => {
        job.tail.push(l);
        if (job.tail.length > CTX.JOB_TAIL) job.tail.shift();
      });
  child.stdout.on('data', onOut);
  child.stderr.on('data', onOut);
  child.on('close', (code) => {
    if (job.status !== 'cancelled') job.status = code === 0 ? 'done' : 'error';
    job.exitCode = code ?? 1;
    job.endedAt = new Date().toISOString();
    job.proc = undefined;
    void CTX.log('info', 'job_done', { id: job.id, op: job.op, status: job.status, exitCode: job.exitCode });
    void persistJob(job);
  });
}

/** POST /run — validate the launch plan, spawn the CLI child, and track it as a job. */
export async function launch(req: IncomingMessage, res: ServerResponse) {
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req, CTX.MAX_BODY)) || '{}');
  } catch {
    return CTX.sendJson(res, 400, { error: 'invalid JSON body' });
  }
  const v = validateLaunch(body);
  if (!v.ok) return CTX.sendJson(res, 400, { error: v.error });
  const dir = resolve(v.plan.dir);
  if (!(await stat(dir).then((s) => s.isDirectory()).catch(() => false)))
    return CTX.sendJson(res, 400, { error: `dir not found: ${dir}` });

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
  startJobProcess(job);
  await CTX.log('info', 'job_start', { id, op: job.op, dir, flags: job.flags });
  await persistJob(job);
  return CTX.sendJson(res, 200, { id, status: job.status });
}

/** Cancel a running job by killing its child process. */
export function cancelJob(id: string, res: ServerResponse) {
  const job = jobs.get(id);
  if (!job) return CTX.sendJson(res, 404, { error: `no job ${id}` });
  if (job.status !== 'running' || !job.proc) return CTX.sendJson(res, 409, { error: `job ${id} not running` });
  job.status = 'cancelled';
  job.proc.kill('SIGTERM');
  void CTX.log('info', 'job_cancel', { id, op: job.op });
  return CTX.sendJson(res, 200, { id, status: 'cancelled' });
}

/** Rebuild the queue from disk (last-wins reduce over the append-only jsonl). */
export async function loadQueue() {
  queue = reduceQueue(await readJsonl<QueueItem>(CTX.QUEUE_PATH).catch(() => []));
}

/** Upsert the item in memory and append its new state to queue.jsonl (reduced on load). */
async function persistItem(item: QueueItem) {
  const i = queue.findIndex((q) => q.id === item.id);
  if (i >= 0) queue[i] = item;
  else queue.push(item);
  await appendJsonl(CTX.QUEUE_PATH, item).catch(() => {});
}

/** POST /enqueue — validate the plan and park it on the supervisor queue for dispatch. */
export async function enqueue(req: IncomingMessage, res: ServerResponse) {
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req, CTX.MAX_BODY)) || '{}');
  } catch {
    return CTX.sendJson(res, 400, { error: 'invalid JSON body' });
  }
  const v = validateLaunch(body);
  if (!v.ok) return CTX.sendJson(res, 400, { error: v.error });
  const item = itemFromPlan(v.plan);
  await persistItem(item);
  await CTX.log('info', 'enqueue', { id: item.id, op: item.op, dir: item.dir });
  return CTX.sendJson(res, 200, { id: item.id, status: 'queued' });
}

/** Ship a dispatched item on accept (best-effort). */
async function shipDispatched(item: QueueItem) {
  if (!CTX.SHIP_ON) return;
  const diary = await latestDiary(item.dir);
  if (!diary) return;
  const r = await shipRun(
    item.dir,
    diary,
    { op: item.op, repo: item.dir },
    (l) => void CTX.log('info', 'ship', { line: l }),
  ).catch(() => null);
  await CTX.log('info', 'queue_ship', { id: item.id, shipped: !!r?.shipped, pr: r?.prUrl });
}

/** stopReason of the newest ledger record for a dir (undefined if none). */
async function latestStop(dir: string): Promise<string | undefined> {
  const { records } = await CTX.scanRuns();
  const d = resolve(dir);
  let stop: string | undefined;
  for (const r of records) if (r.dir && resolve(r.dir) === d) stop = r.stopReason;
  return stop;
}

/** Dispatch one queued item, triaging a non-zero exit by *why* the run stopped:
 *  a transient crash/error backoff-retries; a deterministic give-up parks with the
 *  reason (retrying can't change it). Mirrors factory.runWithRetry. */
async function dispatch(item: QueueItem) {
  await persistItem(mark(item, 'running'));
  await CTX.log('info', 'queue_run', { id: item.id, op: item.op, dir: item.dir });
  const code: number = await new Promise((res) => {
    const child = spawn(CTX.BIN, [item.op, item.dir, ...item.flags], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('close', (c) => res(c ?? 1));
    child.on('error', () => res(1));
  });
  const accepted = code === 0;
  const ran = queue.find((q) => q.id === item.id)!; // has the bumped attempts
  const stop = accepted ? 'accepted' : await latestStop(item.dir);
  if (accepted) {
    await persistItem(mark(ran, 'done', { exitCode: code, endedAt: new Date().toISOString() }));
  } else if (isTransientStop(stop) && ran.attempts < CTX.QUARANTINE) {
    // Transient (crash/error) under the retry budget → re-queue with backoff.
    const nextAt = Date.now() + backoffMs(ran.attempts);
    await persistItem(mark(ran, 'queued', { exitCode: code, nextAt }));
    await CTX.log('info', 'queue_retry', { id: item.id, attempts: ran.attempts, backoffMs: backoffMs(ran.attempts) });
  } else {
    // Park: a deterministic give-up, or the retry budget is spent.
    await persistItem(mark(ran, 'error', { exitCode: code, endedAt: new Date().toISOString() }));
    await CTX.log('error', 'queue_park', { id: item.id, attempts: ran.attempts, stopReason: stop });
  }
  await CTX.log(accepted ? 'info' : 'error', 'queue_done', { id: item.id, exitCode: code, stopReason: stop });
  if (accepted) await shipDispatched(ran);
}

/** Supervisor tick: pull the next ready item and run it (one at a time). */
export async function supervise() {
  if (!CTX.QUEUE_ON || supervising || paused) return;
  // Global budget ceiling: over the cap → pause the line (keep serving).
  if (CTX.BUDGET_CAP > 0) {
    const { records } = await CTX.scanRuns();
    if (overCap(records, CTX.BUDGET_CAP, CTX.BUDGET_WINDOW, Date.now())) {
      paused = true;
      await CTX.log('error', 'budget_halt', { capUsd: CTX.BUDGET_CAP, windowHrs: CTX.BUDGET_WINDOW });
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
    await CTX.log('error', 'supervise_error', { error: String(e?.message ?? e) });
  } finally {
    supervising = false;
  }
}

// SSE-tail every file in `evDir` matching `pattern`, rebroadcasting new lines as
// appended. /stream tails the state-root events mirror (so worktree runs, whose
// workdir .probevane is thrown away, still stream); /transcript tails the workdir.
export async function streamFiles(
  dir: string,
  pattern: RegExp,
  res: ServerResponse,
  req: IncomingMessage,
  opts: {
    sinceMs?: number; // only tail files modified at/after this time (the current run) — skips history
    raw?: boolean; // treat `dir` as the events dir itself (the state mirror) rather than <dir>/.probevane
  } = {},
) {
  const { sinceMs, raw = false } = opts;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  const evDir = raw ? dir : join(resolve(dir), '.probevane');
  const offsets = new Map<string, number>();
  let alive = true;
  req.on('close', () => (alive = false));
  while (alive) {
    let files = (await readdir(evDir).catch(() => [])).filter((f) => pattern.test(f));
    if (sinceMs !== undefined) {
      const withMtime = await Promise.all(
        files.map(async (f) => ({ f, m: (await stat(join(evDir, f)).catch(() => ({ mtimeMs: 0 }))).mtimeMs })),
      );
      files = withMtime.filter((x) => x.m >= sinceMs).map((x) => x.f);
    }
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

/** GET /stream — SSE-tail the CURRENT run's events from the state-root mirror
 *  (statePath('events')/<runId>.jsonl), which every run writes to (including
 *  worktree runs, whose workdir events are discarded). mtime-scoped to files
 *  touched since connect (small grace) so the dir's history isn't replayed — that
 *  would flood the UI and close it on an old run's stopReason. `dir` is unused: the
 *  mirror is global and the mtime window isolates the run the tab just launched. */
export async function streamEvents(_dir: string, res: ServerResponse, req: IncomingMessage) {
  return streamFiles(statePath('events'), /^run-.*\.jsonl$/, res, req, { sinceMs: Date.now() - 5000, raw: true });
}
