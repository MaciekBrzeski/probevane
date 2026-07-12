// Pure job-persistence helpers for the daemon control center (Cluster 4). The
// daemon persists each launched job to jobs.jsonl (append-only, last-write-wins)
// so a restart keeps history; these decide how to reduce the log on load and which
// jobs to evict to keep the in-memory map bounded. No I/O — the daemon does that.

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { newItem, type QueueItem } from './queue.js';
import type { LaunchPlan } from './launch.js';

/** One launched job as persisted to jobs.jsonl — the daemon appends a row per
 *  status change; reduceJobs() collapses the log on load. */
export interface PersistedJob {
  id: string;
  op: string;
  dir: string;
  flags: string[];
  pid?: number;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  tail: string[];
}

/** Reduce the append-only log to one entry per id (last wins). A job still marked
 *  'running' was orphaned when the daemon stopped → mark it 'error'. */
export function reduceJobs(rows: PersistedJob[]): PersistedJob[] {
  const m = new Map<string, PersistedJob>();
  for (const r of rows) m.set(r.id, r);
  return [...m.values()].map((j) =>
    j.status === 'running'
      ? { ...j, status: 'error' as const, exitCode: j.exitCode ?? -1, endedAt: j.endedAt ?? '' }
      : j,
  );
}

/** IDs of the oldest FINISHED jobs to drop so the set is ≤ max (never evicts a
 *  running job). Returns [] when already within budget. */
export function jobsToEvict(jobs: PersistedJob[], max: number): string[] {
  if (jobs.length <= max) return [];
  const need = jobs.length - max;
  return jobs
    .filter((j) => j.status !== 'running')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(0, need)
    .map((j) => j.id);
}

/** Build a fresh queued item from a validated launch plan — shared by the daemon's
 *  /enqueue endpoint and the `enqueue` CLI (same id/op/dir/flags/timestamp shape). */
export function itemFromPlan(plan: LaunchPlan): QueueItem {
  return newItem(randomUUID().slice(0, 8), plan.op, resolve(plan.dir), plan.flags, new Date().toISOString());
}
