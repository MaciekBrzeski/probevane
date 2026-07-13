import { summarize, type RunRecord, type LedgerSummary } from '../cost/ledger.js';

// Cross-repo aggregation over time (Phase 4 OPERATE/OBSERVE). Pure: given the
// merged run records from every ledger the daemon discovered, roll them into
// headline totals (reusing the ledger summary) + a per-day time series the daemon
// serves and the alerting core reads. No I/O here — the daemon does the scanning.

export interface DailyBucket {
  date: string; // YYYY-MM-DD (UTC)
  runs: number;
  cost: number;
  accepted: number;
  acceptRate: number;
  tokensIn: number;
  tokensOut: number;
  errors: number; // runs that stopped on error
}

/** Headline totals + per-day series over every discovered ledger — built by
 *  aggregateOverTime(); the daemon serves it, the alerting core reads `daily`. */
export interface OverTime {
  totals: LedgerSummary;
  daily: DailyBucket[]; // ascending by date
  firstTs: string | null;
  lastTs: string | null;
}

/** UTC calendar day of an ISO timestamp ('2026-06-26T…' → '2026-06-26'). */
export function dayOf(ts: string): string {
  return (ts || '').slice(0, 10);
}

/** A fresh zeroed bucket for one calendar day. */
function emptyBucket(date: string): DailyBucket {
  return { date, runs: 0, cost: 0, accepted: 0, acceptRate: 0, tokensIn: 0, tokensOut: 0, errors: 0 };
}

/** Fold one record into its day bucket (creating it on first sight). */
function accumulate(byDay: Map<string, DailyBucket>, r: RunRecord): void {
  const date = dayOf(r.ts);
  const b = byDay.get(date) ?? byDay.set(date, emptyBucket(date)).get(date)!;
  b.runs++;
  b.cost += r.cost;
  b.tokensIn += r.tokensIn;
  b.tokensOut += r.tokensOut;
  if (r.accepted) b.accepted++;
  if (r.stopReason === 'error') b.errors++;
}

/** Roll records into totals + an ascending per-day time series. */
export function aggregateOverTime(records: RunRecord[]): OverTime {
  const byDay = new Map<string, DailyBucket>();
  let firstTs: string | null = null;
  let lastTs: string | null = null;

  for (const r of records) {
    if (!firstTs || r.ts < firstTs) firstTs = r.ts;
    if (!lastTs || r.ts > lastTs) lastTs = r.ts;
    accumulate(byDay, r);
  }

  const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const b of daily) {
    b.cost = Math.round(b.cost * 1e6) / 1e6;
    b.acceptRate = b.runs ? +(b.accepted / b.runs).toFixed(3) : 0;
  }

  return { totals: summarize(records), daily, firstTs, lastTs };
}
