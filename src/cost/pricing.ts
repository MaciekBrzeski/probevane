// Token pricing (USD per million tokens) for the run-cost ledger. Sourced from
// the Anthropic pricing reference. Cache reads bill ~0.1× input; local/replay
// models are free. Aliases resolve by substring so `claude-haiku-4-5-20251001`
// and the bare alias both match.
export interface Usage {
  input: number; // uncached input tokens
  output: number;
  cacheRead?: number;
}

const PRICES: Record<string, { in: number; out: number }> = {
  'opus-4-8': { in: 5, out: 25 },
  'sonnet-4-6': { in: 3, out: 15 },
  'haiku-4-5': { in: 1, out: 5 },
  'opus-4-7': { in: 5, out: 25 },
};
const CACHE_READ_FACTOR = 0.1;

// Per-Mtoken rates for a model id (substring match); unknown/local/replay price at 0 = free.
export function rateFor(model: string): { in: number; out: number } {
  for (const [k, v] of Object.entries(PRICES)) if (model.includes(k)) return v;
  return { in: 0, out: 0 }; // local:/replay/unknown → free
}

/** Cost in USD for one run's token usage. */
export function costOf(model: string, u: Usage): number {
  const r = rateFor(model);
  const cr = u.cacheRead ?? 0;
  const dollars = (u.input * r.in + u.output * r.out + cr * r.in * CACHE_READ_FACTOR) / 1_000_000;
  return Math.round(dollars * 1e6) / 1e6; // round to micro-dollars
}
