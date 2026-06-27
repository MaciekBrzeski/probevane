import type { RunRecord } from './ledger.js';

// Global budget guard (Pillar C) — pure. The supervisor checks the fleet's recent
// spend before dispatching; over the cap → pause the line (don't start new runs).
// Per-run budget already exists in the engine; this is the aggregate ceiling.

/** Total cost of runs whose ts is within the trailing window ending at `now`. */
export function spentSince(records: RunRecord[], sinceMs: number, now: number): number {
  let total = 0;
  for (const r of records) {
    const t = Date.parse(r.ts) || 0;
    if (t >= sinceMs && t <= now) total += r.cost;
  }
  return Math.round(total * 1e6) / 1e6;
}

/** True when trailing-window spend meets/exceeds the cap (cap<=0 → no cap). */
export function overCap(records: RunRecord[], capUsd: number, windowHrs: number, now: number): boolean {
  if (!capUsd || capUsd <= 0) return false;
  const since = now - windowHrs * 3_600_000;
  return spentSince(records, since, now) >= capUsd;
}
