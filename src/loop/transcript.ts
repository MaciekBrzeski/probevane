// Full loop transcript — the per-turn conversation record persisted to disk so a
// run can be reviewed (post-hoc or live) in the control center. Distinct from
// events.ts (metadata only) and from the engine's in-memory `messages` (pruned
// after 8 turns, never persisted). Written VERBATIM (uncapped) by the loop child
// to <workdir>/.probevane/transcript-<runId>.jsonl, one line per model turn.
// It is never re-sent to the model, so size costs disk only — not tokens.

import type { BrainResponse, ToolCall, ToolResult } from './types.js';

/** One recorded turn: the assistant's text + tool calls, and the results those
 *  calls produced (folded into the same entry rather than a following user turn
 *  so the viewer reads call→result together). `model` is captured per turn, so a
 *  takeover mid-run shows the stronger model on the turns it drove. */
export interface TranscriptTurn {
  /** ISO-8601 timestamp */
  ts: string;
  runId: string;
  step: number;
  role: 'user' | 'assistant';
  /** The brain model that produced this turn (assistant turns). */
  model?: string;
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
  toolResults?: { name: string; ok: boolean; content: string }[];
  tokensIn?: number;
  tokensOut?: number;
}

/** Map a ToolResult back to its call's name via the id→name map (results carry
 *  only the call id). Unknown ids fall back to the id itself. */
function resultName(id: string, callName: Map<string, string>): string {
  return callName.get(id) ?? id;
}

/** Build an assistant turn from a brain response + the results its calls produced.
 *  Verbatim — no truncation (transcript bounds disk, not tokens). */
export function buildTurn(args: {
  runId: string;
  step: number;
  model?: string;
  text?: string;
  toolCalls?: ToolCall[];
  results?: ToolResult[];
  usage?: BrainResponse['usage'];
  ts?: string;
}): TranscriptTurn {
  const callName = new Map<string, string>();
  for (const c of args.toolCalls ?? []) callName.set(c.id, c.name);
  const turn: TranscriptTurn = {
    ts: args.ts ?? new Date().toISOString(),
    runId: args.runId,
    step: args.step,
    role: 'assistant',
  };
  if (args.model) turn.model = args.model;
  if (args.text) turn.text = args.text;
  if (args.toolCalls?.length)
    turn.toolCalls = args.toolCalls.map((c) => ({ name: c.name, input: c.input }));
  if (args.results?.length)
    turn.toolResults = args.results.map((r) => ({
      name: resultName(r.id, callName),
      ok: !r.isError,
      content: r.content,
    }));
  if (args.usage) {
    turn.tokensIn = args.usage.input;
    turn.tokensOut = args.usage.output;
  }
  return turn;
}

/** The seed turn: the user task that opened the run (step 0). */
export function userTurn(runId: string, text: string, ts?: string): TranscriptTurn {
  return { ts: ts ?? new Date().toISOString(), runId, step: 0, role: 'user', text };
}

/** Serialise a turn to a single compact JSON line (no embedded newlines). */
export function formatTurn(t: TranscriptTurn): string {
  return JSON.stringify(t);
}

/** Parse JSONL transcript text into turns. Blank / partial (mid-write) lines are
 *  silently skipped — the file is appended live, so a reader may catch a torn
 *  final line (crash-safe, like parseEvents). */
export function parseTranscript(text: string): TranscriptTurn[] {
  if (!text) return [];
  const out: TranscriptTurn[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as TranscriptTurn);
    } catch {
      // skip malformed / partially-written lines
    }
  }
  return out;
}
