// Work queue for the supervisor (Pillar B) — the daemon pulls from this on its
// tick and dispatches runs, instead of waiting for POST /run. Pure: the daemon
// persists items to <root>/queue.jsonl (append + reduce, like jobs.jsonl) and does
// the spawning; these are the testable decisions (reduce / pick-next / transition).

export type QueueStatus = 'queued' | 'running' | 'done' | 'error';

/** One unit of queued work as persisted to queue.jsonl — created by newItem(),
 *  advanced immutably by mark(), collapsed on load by reduceQueue(). */
export interface QueueItem {
  id: string;
  op: string; // generate / refactor / factory / …
  dir: string;
  flags: string[];
  status: QueueStatus;
  attempts: number;
  enqueuedAt: string;
  nextAt: number; // epoch ms — earliest this item may run (backoff)
  endedAt?: string;
  exitCode?: number;
}

/** Reduce the append-only log to one item per id (last write wins). */
export function reduceQueue(rows: QueueItem[]): QueueItem[] {
  const m = new Map<string, QueueItem>();
  for (const r of rows) m.set(r.id, r);
  return [...m.values()];
}

/** The next item ready to run: queued, backoff elapsed, oldest first. null if none. */
export function nextReady(items: QueueItem[], now: number): QueueItem | null {
  const ready = items
    .filter((i) => i.status === 'queued' && i.nextAt <= now)
    .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  return ready[0] ?? null;
}

/** A fresh queued item. */
export function newItem(id: string, op: string, dir: string, flags: string[], at: string): QueueItem {
  return { id, op, dir, flags, status: 'queued', attempts: 0, enqueuedAt: at, nextAt: 0 };
}

/** Transition an item (immutable) — bump attempts on running, stamp end on finish. */
export function mark(
  item: QueueItem,
  status: QueueStatus,
  extra: { exitCode?: number; endedAt?: string; nextAt?: number } = {},
): QueueItem {
  return {
    ...item,
    status,
    attempts: status === 'running' ? item.attempts + 1 : item.attempts,
    ...(extra.exitCode !== undefined ? { exitCode: extra.exitCode } : {}),
    ...(extra.endedAt ? { endedAt: extra.endedAt } : {}),
    ...(extra.nextAt !== undefined ? { nextAt: extra.nextAt } : {}),
  };
}

/** Headline queue counts for /queue + health. */
export function queueSummary(items: QueueItem[]): Record<QueueStatus, number> {
  const s: Record<QueueStatus, number> = { queued: 0, running: 0, done: 0, error: 0 };
  for (const i of items) s[i.status]++;
  return s;
}
