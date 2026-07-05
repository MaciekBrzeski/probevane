/**
 * Live loop observability — event format for structured JSONL logging.
 */

export interface LoopEvent {
  /** ISO-8601 timestamp */
  ts: string;
  /** Unique identifier for this agent run */
  runId: string;
  /** Step number within the run */
  step: number;
  /** Name of the tool invoked at this step, if any */
  tool?: string;
  /** Total number of tool calls made so far in this step */
  toolCalls: number;
  /** Number of gate blocks encountered at this step */
  gateBlocks: number;
  /** Reasons for gate blocks, if any */
  gateBlockReasons?: string[];
  /** Rune that BLOCKED at this step (drives the console's live pipeline). */
  gate?: string;
  /** LLM tokens consumed (input) */
  tokensIn: number;
  /** LLM tokens produced (output) */
  tokensOut: number;
  /** Source files edited during this step */
  editedFiles?: string[];
  /** Live-token text chunk (PROBEVANE_STREAM_TOKENS=1) — partial model output. */
  delta?: string;
  /** Reason the LLM stopped (e.g. "end_turn", "max_tokens") */
  stopReason?: string;
  /** Whether the run was ultimately accepted */
  accepted?: boolean;
  /** Difficulty-gate proposal emitted when the loop stops circling (stopReason "difficulty"). */
  proposal?: string;
}

/**
 * Serialises a LoopEvent to a single compact JSON line (no embedded newlines).
 */
export function formatEvent(ev: LoopEvent): string {
  return JSON.stringify(ev);
}

/**
 * Parses a JSONL text (one event per line) into an array of LoopEvents.
 * Empty lines and lines that are not valid JSON are silently skipped.
 */
export function parseEvents(text: string): LoopEvent[] {
  if (!text) return [];
  const results: LoopEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LoopEvent;
      results.push(parsed);
    } catch {
      // silently skip malformed lines
    }
  }
  return results;
}
