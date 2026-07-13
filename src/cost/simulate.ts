// Cost simulator — compare test-gen strategies on a codebase BEFORE spending.
// Grounded in MEASURED per-module averages from this project's own cost ledger
// (~/.local/share/probevane/runs.jsonl), not guesses.

export const MEASURED = {
  // ledger avg, haiku-4-5 (n=9, ~81k in / 14.5k out): easy/mid module via API.
  easyApi: 0.16,
  // ledger avg, sonnet-4-6 (n=5, ~224k in / 8.6k out): hard glue module via API.
  hardApi: 0.82,
  // bridge (90 runs) + local (qwen/gemma/lorashim): $0 API (subscription/electricity).
  free: 0,
};

/** Module counts for the target repo, split by the band that decides model routing. */
export interface Codebase {
  easy: number; // pure, low-fact modules (local-draftable)
  hard: number; // fact-heavy / IO / component modules
}

/** One strategy's simulated price tag — produced by simulateCost, compared by savings(). */
export interface StrategyCost {
  name: string;
  cost: number; // USD (API), rounded to cents-ish
  note: string;
}

/**
 * Cost per strategy for a codebase. `localHitRate` = fraction of easy modules a
 * local model actually lands ($0); the rest fall back to API. Measured local
 * reliability on the easy band is ~0.5 (events.ts landed, format.ts didn't).
 */
export function simulateCost(cb: Codebase, localHitRate = 0.5): StrategyCost[] {
  const { easyApi: E, hardApi: H } = MEASURED;
  const r = Math.max(0, Math.min(1, localHitRate));
  const round = (n: number) => Math.round(n * 100) / 100;
  return [
    { name: 'all-api', cost: round(cb.easy * E + cb.hard * H), note: 'haiku easy + sonnet hard — fully metered baseline' },
    { name: 'hybrid (local easy + api hard)', cost: round(cb.easy * (1 - r) * E + cb.hard * H), note: `local clears ${Math.round(r * 100)}% of easy free; api does the rest + all hard` },
    { name: 'bridge / local-only', cost: 0, note: '$0 API — subscription tokens + in-session servicing (not truly free, just unmetered)' },
  ];
}

/** Savings of each strategy vs the all-api baseline. */
export function savings(strategies: StrategyCost[]): Array<StrategyCost & { savedVsBaseline: number; pct: number }> {
  const base = strategies[0]?.cost ?? 0;
  return strategies.map((s) => ({
    ...s,
    savedVsBaseline: Math.round((base - s.cost) * 100) / 100,
    pct: base > 0 ? Math.round(((base - s.cost) / base) * 100) : 0,
  }));
}

// Render the simulation as an aligned terminal table (strategies + savings vs baseline).
export function formatReport(cb: Codebase, localHitRate = 0.5): string {
  const rows = savings(simulateCost(cb, localHitRate));
  const lines = [
    `Cost simulation — ${cb.easy} easy + ${cb.hard} hard module(s), local hit-rate ${Math.round(localHitRate * 100)}%`,
    `(measured: easy≈$${MEASURED.easyApi}/mod haiku, hard≈$${MEASURED.hardApi}/mod sonnet)`,
    '',
    ...rows.map((s) => `  ${s.name.padEnd(32)} $${s.cost.toFixed(2).padStart(7)}  ${s.pct ? `(-${s.pct}%)` : ''}  ${s.note}`),
  ];
  return lines.join('\n');
}
