import type { RunCtx } from './ctx.js';
import type { ToolCall, ToolResult } from './types.js';

// Rune contract — ported from runestone crates/runestone-core/src/rune/mod.rs.
// A Rune is a gate/harness plugged into fixed hooks of the loop. Order matters:
// the first Rune to Block short-circuits.

export type RuneDecision =
  | { kind: 'allow' }
  | { kind: 'block'; reason: string; inject?: string; rune?: string };

export const ALLOW: RuneDecision = { kind: 'allow' };
export function block(reason: string, inject?: string): RuneDecision {
  return { kind: 'block', reason, inject };
}

export interface Rune {
  name: string;

  /** Static rule text appended to the system prompt. `ctx` is optional — most additions are static. */
  systemPromptAddition?(ctx?: RunCtx): string | undefined;

  /** Async pre-run contribution (e.g. RAG few-shot). Returns text to append. */
  prepare?(ctx: RunCtx): Promise<string | undefined>;

  onTurnStart?(ctx: RunCtx): Promise<void>;

  /** Veto a tool call before it runs. */
  beforeToolCall?(call: ToolCall, ctx: RunCtx): Promise<RuneDecision>;

  /** Observe a completed tool call (track state). */
  afterToolCall?(call: ToolCall, result: ToolResult, ctx: RunCtx): Promise<void>;

  /** Gate the model's intent to finish. Block => loop continues with `inject`. */
  shouldStop?(ctx: RunCtx): Promise<RuneDecision>;

  onStop?(ctx: RunCtx): Promise<void>;
}

/** First blocking decision wins (runestone dispatch order). */
export async function firstBlockBefore(
  runes: Rune[],
  call: ToolCall,
  ctx: RunCtx,
): Promise<RuneDecision> {
  for (const r of runes) {
    if (!r.beforeToolCall) continue;
    const d = await r.beforeToolCall(call, ctx);
    if (d.kind === 'block') return { ...d, rune: d.rune ?? r.name };
  }
  return ALLOW;
}

export async function firstBlockStop(runes: Rune[], ctx: RunCtx): Promise<RuneDecision> {
  for (const r of runes) {
    if (!r.shouldStop) continue;
    const d = await r.shouldStop(ctx);
    if (d.kind === 'block') return { ...d, rune: d.rune ?? r.name };
  }
  return ALLOW;
}
