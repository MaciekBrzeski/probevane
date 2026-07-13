import type { BrainRequest } from '../brain/brain.js';
import type { Msg, ToolCall, ToolSpec } from '../loop/types.js';

// Token ESTIMATOR for $0 brains (bridge/local). The bridge bills nothing, so the
// real API never counts its tokens — but Phase-5 cost projection needs a token
// volume to reprice at API rates. This is a heuristic (chars→tokens), grounded in
// Anthropic's ~3.5 chars/token rule of thumb for mixed prose+JSON; override via
// PROBEVANE_TOKENS_PER_CHAR. For an exact count, set PROBEVANE_COUNT_TOKENS=1 and
// route through the SDK's count_tokens (key permitting) — not wired here so the
// estimate stays offline + free. Estimates, clearly labelled as such.

const CHARS_PER_TOKEN = Number(process.env.PROBEVANE_TOKENS_PER_CHAR ?? '3.5');
const MSG_OVERHEAD = 4; // role + framing tokens per message (Anthropic-ish)

/** Estimated tokens for a blob of text. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Chars one tool call adds to the transcript (name + serialized input).
function callChars(c: ToolCall): number {
  return c.name.length + JSON.stringify(c.input ?? {}).length;
}

// Chars one message adds (text + tool calls + tool results).
function msgChars(m: Msg): number {
  let n = (m.text ?? '').length;
  for (const c of m.toolCalls ?? []) n += callChars(c);
  for (const r of m.toolResults ?? []) n += (r.content ?? '').length;
  return n;
}

// Chars one tool schema adds to the request (name + description + JSON schema).
function toolChars(t: ToolSpec): number {
  return t.name.length + t.description.length + JSON.stringify(t.inputSchema ?? {}).length;
}

/** Estimated INPUT tokens for a brain request (system + transcript + tool schemas). */
export function estimateRequestTokens(req: Pick<BrainRequest, 'system' | 'messages' | 'tools'>): number {
  let chars = (req.system ?? '').length;
  for (const m of req.messages) chars += msgChars(m);
  for (const t of req.tools) chars += toolChars(t);
  return Math.ceil(chars / CHARS_PER_TOKEN) + req.messages.length * MSG_OVERHEAD;
}

/** Estimated OUTPUT tokens for a completion (assistant text + tool-call inputs). */
export function estimateOutputTokens(text: string, toolCalls: ToolCall[] = []): number {
  let chars = (text ?? '').length;
  for (const c of toolCalls) chars += callChars(c);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}
