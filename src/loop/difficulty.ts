// Difficulty gate — detect a loop "going in circles" so we stop early and propose
// a way forward instead of silently burning the whole step budget (the cost-ledger
// lesson: stuck hard modules churn to max_steps for 0 accepts). Pure + testable:
// reads only the two signals the engine already tracks.

export interface DifficultySignals {
  /** RAW (non-deduped) gate-block reasons, oldest→newest. */
  gateBlockHistory: string[];
  /** Last-N tool-call signatures `${name}:${JSON.stringify(input)}`. */
  recentCalls: string[];
}

export const CIRCULAR_THRESHOLD = 3;

function topRepeat(items: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  let best: { value: string; count: number } | null = null;
  for (const it of items) {
    const c = (counts.get(it) ?? 0) + 1;
    counts.set(it, c);
    if (!best || c > best.count) best = { value: it, count: c };
  }
  return best;
}

/** The tool name in a recentCalls signature (`write_file:{...}` → `write_file`). */
function callName(sig: string): string {
  const i = sig.indexOf(':');
  return i > 0 ? sig.slice(0, i) : sig;
}

/**
 * True when the loop is circling: the SAME gate-block reason repeats ≥threshold
 * times, OR an IDENTICAL tool call (name + input) repeats ≥threshold times.
 */
export function isCircular(s: DifficultySignals, threshold = CIRCULAR_THRESHOLD): boolean {
  return (
    (topRepeat(s.gateBlockHistory)?.count ?? 0) >= threshold ||
    (topRepeat(s.recentCalls)?.count ?? 0) >= threshold
  );
}

/**
 * Deterministic, human-readable proposal naming the dominant blocker(s) and a
 * concrete next step. Used as-is, and as the seed for an optional LLM proposal turn.
 */
export function proposal(s: DifficultySignals, threshold = CIRCULAR_THRESHOLD): string {
  const g = topRepeat(s.gateBlockHistory);
  const c = topRepeat(s.recentCalls);
  const bits: string[] = [];
  if (g && g.count >= threshold) bits.push(`blocked on "${g.value}" ×${g.count}`);
  if (c && c.count >= threshold) bits.push(`repeated ${callName(c.value)} ×${c.count}`);
  const blocker = bits.length ? bits.join(' and ') : 'no forward progress';
  return (
    `Stuck — ${blocker}. Suggested next steps: split the target into smaller modules, ` +
    `raise --max-steps, or test a simpler sibling first.`
  );
}
