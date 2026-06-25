import type { LoopEvent } from './events.js';

// Pure observability logic — extracted from the serve/peek shells so the gated
// loop can test-drive it (former "irreducible glue" becomes loop-buildable).
// serve.ts / peek.ts keep only their I/O (http / terminal); everything decided
// here is pure and unit-tested.

/** Format one SSE message frame. */
export function sseFrame(payload: string): string {
  return `data: ${payload}\n\n`;
}

/** New whole lines appended to `content` since byte `offset`; returns them + the new offset. */
export function tailFrom(content: string, offset: number): { lines: string[]; offset: number } {
  if (offset >= content.length) return { lines: [], offset: content.length };
  const slice = content.slice(offset);
  return { lines: slice.split('\n').filter(Boolean), offset: content.length };
}

/** Collapse a stream of events to the latest merged event per runId. */
export function latestPerRun(events: LoopEvent[]): Map<string, LoopEvent> {
  const m = new Map<string, LoopEvent>();
  for (const e of events) m.set(e.runId, { ...(m.get(e.runId) ?? {}), ...e });
  return m;
}

/** One-word status for a run's latest event. */
export function runStatus(e: LoopEvent): string {
  if (e.stopReason) return e.accepted ? '✅ accepted' : `🛑 ${e.stopReason}`;
  return `▶ step ${e.step}`;
}
