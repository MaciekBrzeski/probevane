import type { RunRecord } from '../cost/ledger.js';

// Cross-run quarantine + backoff (Pillar C) — pure. A repo (run label) that keeps
// erroring shouldn't be retried forever; count consecutive recent errors and back
// off / quarantine. The supervisor uses backoffMs to set an item's nextAt and
// quarantined() to skip a poisoned target.

/** Consecutive trailing errors per label (newest-first scan; a non-error resets). */
export function consecutiveErrors(records: RunRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  const settled = new Set<string>(); // labels whose streak is fixed (hit a non-error)
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (settled.has(r.label)) continue;
    if (r.accepted || r.stopReason === 'accepted') {
      settled.add(r.label); // streak broken by a success
      out[r.label] = out[r.label] ?? 0;
    } else {
      out[r.label] = (out[r.label] ?? 0) + 1;
    }
  }
  return out;
}

/** A label is quarantined once its consecutive-error count reaches the threshold. */
export function quarantined(stats: Record<string, number>, label: string, threshold: number): boolean {
  return (stats[label] ?? 0) >= threshold;
}

/** Exponential backoff (ms) for the Nth attempt: base·2^(n-1), capped. */
export function backoffMs(attempts: number, baseMs = 60_000, capMs = 3_600_000): number {
  if (attempts <= 0) return 0;
  return Math.min(capMs, baseMs * 2 ** (attempts - 1));
}
