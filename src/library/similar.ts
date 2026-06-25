import type { Trace } from '../distill/collect.js';

// Pick the most similar ACCEPTED trace to inject as a worked exemplar ON STALL.
// Per the novel-vs-familiar lesson, exemplars help novel local-solve only when
// surfaced on retry — so this feeds the consult ladder, not the base prompt.
// Pure + testable: ranks accepted-trace task descriptions by keyword overlap.

const STOP = new Set([
  'the', 'and', 'for', 'add', 'use', 'only', 'this', 'that', 'with', 'below', 'ground',
  'truth', 'file', 'spec', 'test', 'tests', 'project', 'write', 'read', 'plan', 'rules',
  'any', 'not', 'must', 'from', 'each', 'one', 'when', 'these', 'their', 'they',
]);

export function tokenize(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
}

/** Jaccard overlap of two token sets (0..1). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Most-similar same-stack accepted trace to `task`, or null when none overlaps.
 * Tie-break by recency (newer `ts` wins) so the freshest exemplar surfaces.
 */
export function pickSimilarTrace(traces: Trace[], task: string, stack: string): Trace | null {
  const q = tokenize(task);
  let best: Trace | null = null;
  let bestScore = 0;
  for (const t of traces) {
    if (t.stack !== stack) continue;
    const sc = similarity(q, tokenize(t.task));
    if (sc > bestScore || (sc === bestScore && best && t.ts > best.ts)) {
      bestScore = sc;
      best = t;
    }
  }
  return bestScore > 0 ? best : null;
}
