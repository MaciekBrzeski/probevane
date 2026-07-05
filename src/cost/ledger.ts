import { costOf } from './pricing.js';
import { statePath } from '../util/state.js';
import { appendJsonl, readJsonl } from '../util/jsonl.js';

// Persistent cross-run cost ledger: one JSON line per run under the state root
// (runs.jsonl). Feeds `probevane history` — total spend, acceptance, how much the
// harness landed vs needed escalation/hand-finishing, per-model / per-path. On by
// default; opt out PROBEVANE_LEDGER=0. Atomic append (no torn lines under
// concurrent runs); path honors PROBEVANE_STATE for per-repo isolation.
export const LEDGER_PATH = statePath('runs.jsonl');

export interface RunRecord {
  ts: string;
  runId: string;
  label: string; // path + target, e.g. "generate:fixtures/x"
  /** Full workdir (label only carries the basename) — run drawer + theater use it. */
  dir?: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cost: number; // USD — brain-reported actual (costUsd) when present, else priced from tokens
  costUsd?: number; // actual cost reported by the brain (claude-code CLI), if any
  accepted: boolean;
  tookOver: boolean;
  stopReason: string;
  steps: number;
  /** Wall-clock run duration. Optional: older ledger lines predate the field. */
  durationMs?: number;
}

export async function recordRun(rec: Omit<RunRecord, 'cost'>): Promise<void> {
  if (process.env.PROBEVANE_LEDGER === '0') return;
  const cost =
    rec.costUsd ?? costOf(rec.model, { input: rec.tokensIn, output: rec.tokensOut, cacheRead: rec.cacheRead });
  const full: RunRecord = { ...rec, cost };
  await appendJsonl(LEDGER_PATH, full).catch(() => {}); // best-effort
}

export async function readRuns(path = LEDGER_PATH): Promise<RunRecord[]> {
  return readJsonl<RunRecord>(path);
}

export interface LedgerSummary {
  runs: number;
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
  accepted: number;
  acceptRate: number;
  /** Accepted by the gated loop with NO escalation — pure harness work. */
  harnessOnly: number;
  /** Accepted only after a stronger model took over. */
  withTakeover: number;
  /** Did not accept — needed hand-finishing. */
  needsHand: number;
  byModel: Record<string, { runs: number; cost: number }>;
  byPath: Record<string, { runs: number; cost: number; accepted: number }>;
  /** Total/average wall-clock over runs that recorded a duration. */
  totalDurationMs: number;
  avgDurationMs: number;
}

/** Roll the ledger up into the headline numbers + the harness-vs-hand split. */
export function summarize(records: RunRecord[]): LedgerSummary {
  const s: LedgerSummary = {
    runs: records.length, totalCost: 0, totalTokensIn: 0, totalTokensOut: 0,
    accepted: 0, acceptRate: 0, harnessOnly: 0, withTakeover: 0, needsHand: 0,
    byModel: {}, byPath: {}, totalDurationMs: 0, avgDurationMs: 0,
  };
  let timed = 0;
  for (const r of records) {
    if (typeof r.durationMs === 'number') { s.totalDurationMs += r.durationMs; timed++; }
    s.totalCost += r.cost; s.totalTokensIn += r.tokensIn; s.totalTokensOut += r.tokensOut;
    if (r.accepted) { s.accepted++; if (r.tookOver) s.withTakeover++; else s.harnessOnly++; } else s.needsHand++;
    const m = (s.byModel[r.model] ??= { runs: 0, cost: 0 }); m.runs++; m.cost += r.cost;
    const path = r.label.split(':')[0];
    const p = (s.byPath[path] ??= { runs: 0, cost: 0, accepted: 0 });
    p.runs++;
    p.cost += r.cost;
    if (r.accepted) p.accepted++;
  }
  s.totalCost = Math.round(s.totalCost * 1e6) / 1e6;
  s.acceptRate = records.length ? +(s.accepted / records.length).toFixed(3) : 0;
  s.avgDurationMs = timed ? Math.round(s.totalDurationMs / timed) : 0;
  return s;
}
