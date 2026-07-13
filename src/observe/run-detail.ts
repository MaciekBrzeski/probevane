import type { RunRecord } from '../cost/ledger.js';
import type { LoopEvent } from '../loop/events.js';

// Run history paging + per-run detail merge for the control center. Pure: the
// daemon reads the ledger / diary / events files and passes them in.

export interface RunsPage {
  total: number;
  runs: RunRecord[];
}

/** Reverse-chronological page of the ledger (newest first). Bounds are clamped. */
export function pageRuns(records: RunRecord[], limit = 50, offset = 0): RunsPage {
  const sorted = [...records].sort((a, b) => b.ts.localeCompare(a.ts));
  const start = Math.max(0, offset);
  const end = Math.max(start, start + Math.max(0, limit));
  return { total: sorted.length, runs: sorted.slice(start, end) };
}

/** One loop step condensed for the run timeline — filled by summarizeEvents()
 *  from that step's events. */
export interface TimelineStep {
  step: number;
  tool?: string;
  gateBlocks: number;
  editedFiles?: string[];
}

/** A run's event stream rolled up — totals, distinct block reasons, step
 *  timeline. Built by summarizeEvents() for the detail view. */
export interface EventsSummary {
  steps: number;
  toolCalls: number;
  gateBlocks: number;
  gateBlockReasons: string[];
  stopReason?: string;
  accepted?: boolean;
  timeline: TimelineStep[];
}

/** Roll a run's event stream into a compact summary + per-step timeline. */
export function summarizeEvents(events: LoopEvent[]): EventsSummary {
  const timeline: TimelineStep[] = [];
  const reasons = new Set<string>();
  let last: LoopEvent | undefined;
  for (const e of events) {
    if (e.step > 0) {
      const t: TimelineStep = { step: e.step, gateBlocks: e.gateBlocks };
      if (e.tool) t.tool = e.tool;
      if (e.editedFiles?.length) t.editedFiles = e.editedFiles;
      timeline.push(t);
    }
    for (const r of e.gateBlockReasons ?? []) reasons.add(r);
    last = e;
  }
  const summary: EventsSummary = {
    steps: last?.step ?? 0,
    toolCalls: last?.toolCalls ?? 0,
    gateBlocks: last?.gateBlocks ?? 0,
    gateBlockReasons: [...reasons],
    timeline,
  };
  if (last?.stopReason) summary.stopReason = last.stopReason;
  if (last && last.accepted !== undefined) summary.accepted = last.accepted;
  return summary;
}

/** Everything the per-run detail view shows — ledger record, diary, event
 *  summary. Assembled by mergeRun(); any source may be missing mid-run. */
export interface RunDetail {
  runId: string;
  record?: RunRecord;
  diary?: unknown;
  events: EventsSummary;
}

/** Merge the three per-run sources into one detail object. Any source may be
 *  missing (a live run has no ledger record yet; events may be empty). */
export function mergeRun(
  runId: string,
  record: RunRecord | undefined,
  diary: unknown,
  events: LoopEvent[],
): RunDetail {
  const detail: RunDetail = { runId, events: summarizeEvents(events) };
  if (record) detail.record = record;
  if (diary !== undefined && diary !== null) detail.diary = diary;
  return detail;
}
