import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { costOf } from './pricing.js';

// Persistent cross-run cost ledger: one JSON line per run to
// ~/.local/share/probevane/runs.jsonl. Feeds `probevane history` — total spend,
// acceptance, how much the harness landed vs needed escalation/hand-finishing,
// and per-model / per-path breakdowns. On by default; opt out PROBEVANE_LEDGER=0.
export const LEDGER_PATH = join(homedir(), '.local/share/probevane/runs.jsonl');

export interface RunRecord {
  ts: string;
  runId: string;
  label: string; // path + target, e.g. "generate:fixtures/x"
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
}

export async function recordRun(rec: Omit<RunRecord, 'cost'>): Promise<void> {
  if (process.env.PROBEVANE_LEDGER === '0') return;
  const cost = rec.costUsd ?? costOf(rec.model, { input: rec.tokensIn, output: rec.tokensOut, cacheRead: rec.cacheRead });
  const full: RunRecord = { ...rec, cost };
  try {
    await mkdir(join(homedir(), '.local/share/probevane'), { recursive: true });
    await appendFile(LEDGER_PATH, JSON.stringify(full) + '\n');
  } catch { /* ledger is best-effort */ }
}

export async function readRuns(path = LEDGER_PATH): Promise<RunRecord[]> {
  const txt = await readFile(path, 'utf8').catch(() => '');
  return txt.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as RunRecord);
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
}

/** Roll the ledger up into the headline numbers + the harness-vs-hand split. */
export function summarize(records: RunRecord[]): LedgerSummary {
  const s: LedgerSummary = {
    runs: records.length, totalCost: 0, totalTokensIn: 0, totalTokensOut: 0,
    accepted: 0, acceptRate: 0, harnessOnly: 0, withTakeover: 0, needsHand: 0,
    byModel: {}, byPath: {},
  };
  for (const r of records) {
    s.totalCost += r.cost; s.totalTokensIn += r.tokensIn; s.totalTokensOut += r.tokensOut;
    if (r.accepted) { s.accepted++; if (r.tookOver) s.withTakeover++; else s.harnessOnly++; } else s.needsHand++;
    const m = (s.byModel[r.model] ??= { runs: 0, cost: 0 }); m.runs++; m.cost += r.cost;
    const path = r.label.split(':')[0];
    const p = (s.byPath[path] ??= { runs: 0, cost: 0, accepted: 0 }); p.runs++; p.cost += r.cost; if (r.accepted) p.accepted++;
  }
  s.totalCost = Math.round(s.totalCost * 1e6) / 1e6;
  s.acceptRate = records.length ? +(s.accepted / records.length).toFixed(3) : 0;
  return s;
}
