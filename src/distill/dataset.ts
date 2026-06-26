import { createHash } from 'node:crypto';
import type { Trace } from './collect.js';

// Build a fine-tuning dataset from accepted traces. We distill the DISCIPLINE
// (how to write a gated, audit-clean, value-asserting test) — not project facts,
// which stay in RAG/context. So the prompt deliberately carries only the task +
// stack, and the completion is the accepted spec. Quality filter + dedup keep
// the set clean and small (≈200 good traces is the sweet spot per the lessons).
export interface ChatExample {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
}

const SYSTEM =
  'You write tests for the given stack. Import the real symbols, assert concrete values, cover edge + error paths, no brittle waits, no conditional assertions. Output only the test file.';

// An asserting test across stacks (js/ts expect/toBe, python/rust assert*, go t.Fatal/Error).
const ASSERTS = /expect|assert|toBe|toEqual|toHaveNoViolations|t\.(Fatal|Error)/;
function isQuality(t: Trace): boolean {
  return ASSERTS.test(t.spec) && t.spec.length > 40;
}

export function buildExamples(traces: Trace[]): ChatExample[] {
  const seen = new Set<string>();
  const out: ChatExample[] = [];
  for (const t of traces) {
    if (!isQuality(t)) continue;
    const key = createHash('sha1').update(t.spec).digest('hex');
    if (seen.has(key)) continue; // dedup identical specs
    seen.add(key);
    // Gate-feedback signal: the accepted spec is the version that cleared these
    // gates, so naming them in the prompt teaches the model to pre-empt them.
    const constraints = t.gateBlocks?.length
      ? `\nGate failures corrected to reach the accepted version (avoid these): ${t.gateBlocks.join('; ')}.`
      : '';
    out.push({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Stack: ${t.stack}\nTask: ${t.task}${constraints}\nWrite the test at ${t.specPath}.` },
        { role: 'assistant', content: t.spec },
      ],
    });
  }
  return out;
}

/** Deterministic 90/10 split by index (no RNG — reproducible datasets). */
export function splitExamples(ex: ChatExample[]): { train: ChatExample[]; val: ChatExample[] } {
  const train: ChatExample[] = [];
  const val: ChatExample[] = [];
  ex.forEach((e, i) => (i % 10 === 9 ? val : train).push(e));
  return { train, val };
}

export function statsByStack(traces: Trace[]): Record<string, number> {
  const s: Record<string, number> = {};
  for (const t of traces) s[t.stack] = (s[t.stack] ?? 0) + 1;
  return s;
}
