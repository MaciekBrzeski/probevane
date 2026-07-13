import type { RunRecord } from './ledger.js';
import { costOf, rateFor } from './pricing.js';

// Phase-5 cost projection: take the metered token volume from $0 runs (bridge /
// local — where the API was never billed) and reprice it at real API rates. Answers
// "what would this build have cost on haiku / sonnet / opus?" from a start-to-finish
// $0 run. A run is "$0" when its model prices at zero (rateFor(model).in === 0).

export const PROJECTION_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'] as const;

/** projectLedger's answer — the metered-but-unbilled token volume, repriced per model. */
export interface Projection {
  /** Runs that were billed $0 and therefore contribute metered-but-free volume. */
  freeRuns: number;
  tokensIn: number;
  tokensOut: number;
  /** Repriced cost per model (USD) if this volume had gone through the API. */
  byModel: Record<string, number>;
}

/** Is this run a $0 (bridge/local/replay) run whose tokens were metered but unbilled? */
export function isFreeRun(r: Pick<RunRecord, 'model'>): boolean {
  return rateFor(r.model).in === 0;
}

/** Project the metered tokens of all $0 runs in `records` at each target model's rates. */
export function projectLedger(
  records: RunRecord[],
  models: readonly string[] = PROJECTION_MODELS,
): Projection {
  let tokensIn = 0, tokensOut = 0, freeRuns = 0;
  for (const r of records) {
    if (!isFreeRun(r)) continue;
    freeRuns++;
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
  }
  const byModel: Record<string, number> = {};
  for (const m of models) byModel[m] = costOf(m, { input: tokensIn, output: tokensOut });
  return { freeRuns, tokensIn, tokensOut, byModel };
}

// Render the projection as a terminal block, clearly labelled as estimates.
export function formatProjection(p: Projection): string {
  const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
  const lines = [
    `Cost projection — ${p.freeRuns} $0 run(s) metered: ${k(p.tokensIn)} in / ${k(p.tokensOut)} out`,
    '(token volume from $0 bridge/local runs, repriced at API rates — estimates)',
    '',
    ...Object.entries(p.byModel).map(
      ([m, c]) => `  ${m.padEnd(20)} ≈ $${c.toFixed(4)}`,
    ),
  ];
  return lines.join('\n');
}
