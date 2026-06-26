import type { StackAdapter } from '../adapters/adapter.js';
import type { ToolCall } from './types.js';

// RunCtx — shared mutable state across the loop, ported from runestone's RuneCtx.
// Runes read/write this; the engine owns its lifecycle.
export interface PlanRecord {
  text: string;
  at: number; // step it was set
}

export class RunCtx {
  workdir: string;
  adapter: StackAdapter;
  task: string;

  runId = ''; // unique per run (set by the engine); diary/events key on it
  checkpointSha = ''; // HEAD before this run edited the workdir — revert restores to it
  step = 0;
  toolCalls = 0;
  gateBlocks = 0;
  barren = 0; // consecutive turns with no productive edit / a blocked stop

  // Outcome, set by the engine before on_stop hooks run (for diary/harvest).
  accepted = false;
  stopReason = 'unknown';
  /** Distinct gate-block reasons seen this run (caveat_harvest feeds these back). */
  gateBlockReasons: string[] = [];
  /** RAW (non-deduped) gate-block reasons — the difficulty gate counts repeats here. */
  gateBlockHistory: string[] = [];

  noteBlock(reason: string) {
    this.gateBlockHistory.push(reason);
    if (!this.gateBlockReasons.includes(reason)) this.gateBlockReasons.push(reason);
  }

  plan: PlanRecord | null = null;
  editedFiles = new Set<string>();
  lastEditPath: string | null = null;
  validatedSinceEdit = false;

  /** Per-run recent tool-call signatures (repetition detection, P-later). */
  recentCalls: string[] = [];

  constructor(workdir: string, adapter: StackAdapter, task: string) {
    this.workdir = workdir;
    this.adapter = adapter;
    this.task = task;
  }

  noteCall(call: ToolCall) {
    this.toolCalls++;
    this.recentCalls.push(`${call.name}:${JSON.stringify(call.input)}`);
    if (this.recentCalls.length > 8) this.recentCalls.shift();
  }
}
