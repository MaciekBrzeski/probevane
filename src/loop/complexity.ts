import type { TestTarget } from '../adapters/adapter.js';
import { buildGraph } from '../mock/graph.js';

// Auto model routing — detect "complex" code and start on a stronger brain
// instead of waiting for the loop to stall and take over. Signals: big module
// graph, networked + stateful app, and high per-target testability cost
// (components needing providers / redux / router).

export interface Complexity {
  complex: boolean;
  score: number;
  reasons: string[];
}

export async function assessComplexity(dir: string, targets: TestTarget[]): Promise<Complexity> {
  const reasons: string[] = [];
  let score = 0;

  const graph = await buildGraph(dir).catch(() => null);
  if (graph) {
    const n = graph.nodes.size;
    const networked = [...graph.nodes.values()].some((m) => m.callsNetwork);
    if (n >= 25) { score += 3; reasons.push(`large app (${n} modules)`); }
    else if (n >= 15) { score += 1; reasons.push(`mid app (${n} modules)`); }
    if (networked) { score += 1; reasons.push('networked'); }
  }

  // Per-target: only provider-heavy targets (redux/router-bound, cost >= 5) count
  // — a plain presentational component is fine for the default model.
  const heavy = targets.filter((t) => Number((t.meta as any)?.cost ?? 0) >= 5).length;
  if (heavy > 0) { score += 2; reasons.push(`${heavy} redux/router-bound target(s)`); }

  return { complex: score >= 3, score, reasons };
}

/** Resolve the primary + takeover models given a --model choice and detected complexity. */
export function routeModels(choice: string, complex: boolean): { primary?: string; takeover?: string } {
  const HAIKU = 'claude-haiku-4-5-20251001';
  const SONNET = 'claude-sonnet-4-6';
  const OPUS = 'claude-opus-4-8';
  if (choice === 'auto') {
    return complex
      ? { primary: SONNET, takeover: OPUS } // start strong, escalate to Opus if stuck
      : { primary: HAIKU, takeover: SONNET };
  }
  if (choice === 'haiku') return { primary: HAIKU, takeover: SONNET };
  if (choice === 'sonnet') return { primary: SONNET, takeover: OPUS };
  if (choice === 'opus') return { primary: OPUS, takeover: OPUS };
  return { primary: choice, takeover: SONNET }; // explicit model id
}
