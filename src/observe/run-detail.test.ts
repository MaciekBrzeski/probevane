// src/observe/run-detail.test.ts
import { describe, it, expect } from 'vitest';
import { pageRuns, summarizeEvents, mergeRun } from './run-detail.js';
import type { RunRecord } from '../cost/ledger.js';
import type { LoopEvent } from '../loop/events.js';

const makeRecord = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId: 'r1',
  ts: '2024-01-01T00:00:00Z',
  label: 'generate:fixtures/x',
  model: 'gpt-4o',
  tokensIn: 10,
  tokensOut: 20,
  cacheRead: 0,
  accepted: true,
  tookOver: false,
  stopReason: 'done',
  steps: 1,
  cost: 0.1,
  ...overrides,
});

const makeEvent = (overrides: Partial<LoopEvent> = {}): LoopEvent => ({
  ts: '2024-01-01T00:00:00Z',
  runId: 'r1',
  step: 1,
  toolCalls: 1,
  gateBlocks: 0,
  tokensIn: 10,
  tokensOut: 20,
  ...overrides,
});

describe('pageRuns', () => {
  it('sorts records reverse-chronologically by ts', () => {
    const records: RunRecord[] = [
      makeRecord({ runId: 'old', ts: '2024-01-01T00:00:00Z' }),
      makeRecord({ runId: 'new', ts: '2024-01-03T00:00:00Z' }),
      makeRecord({ runId: 'mid', ts: '2024-01-02T00:00:00Z' }),
    ];
    const result = pageRuns(records);
    expect(result.total).toBe(3);
    expect(result.runs.map((r) => r.runId)).toEqual(['new', 'mid', 'old']);
  });

  it('respects limit and offset', () => {
    const records: RunRecord[] = [
      makeRecord({ runId: 'a', ts: '2024-01-03T00:00:00Z' }),
      makeRecord({ runId: 'b', ts: '2024-01-02T00:00:00Z' }),
      makeRecord({ runId: 'c', ts: '2024-01-01T00:00:00Z' }),
    ];
    const result = pageRuns(records, 1, 1);
    expect(result.total).toBe(3);
    expect(result.runs.map((r) => r.runId)).toEqual(['b']);
  });

  it('clamps negative offset to 0', () => {
    const records: RunRecord[] = [makeRecord({ runId: 'a', ts: '2024-01-01T00:00:00Z' })];
    const result = pageRuns(records, 10, -5);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].runId).toBe('a');
  });

  it('clamps negative limit to 0', () => {
    const records: RunRecord[] = [makeRecord({ runId: 'a', ts: '2024-01-01T00:00:00Z' })];
    const result = pageRuns(records, -5, 0);
    expect(result.runs).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  it('clamps end beyond total length', () => {
    const records: RunRecord[] = [makeRecord({ runId: 'a', ts: '2024-01-01T00:00:00Z' })];
    const result = pageRuns(records, 100, 0);
    expect(result.runs).toHaveLength(1);
  });

  it('returns empty runs for empty input', () => {
    const result = pageRuns([]);
    expect(result.total).toBe(0);
    expect(result.runs).toEqual([]);
  });

  it('returns empty runs when offset is greater than or equal to total', () => {
    const records: RunRecord[] = [makeRecord({ runId: 'a', ts: '2024-01-01T00:00:00Z' })];
    const result = pageRuns(records, 10, 1);
    expect(result.total).toBe(1);
    expect(result.runs).toEqual([]);
  });
});

describe('summarizeEvents', () => {
  it('returns zeros and empty timeline for empty events', () => {
    const result = summarizeEvents([]);
    expect(result).toEqual({
      steps: 0,
      toolCalls: 0,
      gateBlocks: 0,
      gateBlockReasons: [],
      timeline: [],
    });
  });

  it('summarizes a single event', () => {
    const events: LoopEvent[] = [
      makeEvent({ step: 1, tool: 'read', toolCalls: 2, gateBlocks: 0 }),
    ];
    const result = summarizeEvents(events);
    expect(result.steps).toBe(1);
    expect(result.toolCalls).toBe(2);
    expect(result.gateBlocks).toBe(0);
    expect(result.timeline).toEqual([{ step: 1, tool: 'read', gateBlocks: 0 }]);
  });

  it('builds timeline entries only for events with step > 0', () => {
    const events: LoopEvent[] = [
      makeEvent({ step: 0, tool: 'init' }),
      makeEvent({ step: 1, tool: 'read' }),
    ];
    const result = summarizeEvents(events);
    expect(result.timeline).toEqual([{ step: 1, tool: 'read', gateBlocks: 0 }]);
    expect(result.steps).toBe(1);
  });

  it('includes editedFiles in timeline when present', () => {
    const events: LoopEvent[] = [
      makeEvent({ step: 1, tool: 'edit', editedFiles: ['src/a.ts'] }),
    ];
    const result = summarizeEvents(events);
    expect(result.timeline).toEqual([
      { step: 1, tool: 'edit', gateBlocks: 0, editedFiles: ['src/a.ts'] },
    ]);
  });

  it('deduplicates gateBlockReasons across events', () => {
    const events: LoopEvent[] = [
      makeEvent({ step: 1, gateBlocks: 1, gateBlockReasons: ['timeout', 'difficulty'] }),
      makeEvent({ step: 2, gateBlocks: 1, gateBlockReasons: ['timeout', 'cost'] }),
    ];
    const result = summarizeEvents(events);
    expect(result.gateBlockReasons).toEqual(['timeout', 'difficulty', 'cost']);
    expect(result.gateBlocks).toBe(1);
  });

  it('carries stopReason and accepted from the last event', () => {
    const events: LoopEvent[] = [
      makeEvent({ step: 1, stopReason: 'max_tokens', accepted: false }),
      makeEvent({ step: 2, stopReason: 'done', accepted: true }),
    ];
    const result = summarizeEvents(events);
    expect(result.stopReason).toBe('done');
    expect(result.accepted).toBe(true);
  });

  it('aggregates last event values even with empty timeline', () => {
    const events: LoopEvent[] = [makeEvent({ step: 0, toolCalls: 5, gateBlocks: 3 })];
    const result = summarizeEvents(events);
    expect(result.steps).toBe(0);
    expect(result.toolCalls).toBe(5);
    expect(result.gateBlocks).toBe(3);
    expect(result.timeline).toEqual([]);
  });
});

describe('mergeRun', () => {
  it('merges all sources when present', () => {
    const record = makeRecord({ runId: 'r1' });
    const diary = { notes: 'ok' };
    const events: LoopEvent[] = [makeEvent({ step: 1, tool: 'read' })];
    const result = mergeRun('r1', record, diary, events);
    expect(result.runId).toBe('r1');
    expect(result.record).toBe(record);
    expect(result.diary).toBe(diary);
    expect(result.events.steps).toBe(1);
    expect(result.events.timeline).toEqual([{ step: 1, tool: 'read', gateBlocks: 0 }]);
  });

  it('omits record when undefined', () => {
    const result = mergeRun('r1', undefined, { notes: 'ok' }, []);
    expect(result.runId).toBe('r1');
    expect(result.record).toBeUndefined();
    expect(result.diary).toEqual({ notes: 'ok' });
  });

  it('omits diary when undefined', () => {
    const result = mergeRun('r1', makeRecord(), undefined, []);
    expect(result.diary).toBeUndefined();
  });

  it('omits diary when null', () => {
    const result = mergeRun('r1', makeRecord(), null, []);
    expect(result.diary).toBeUndefined();
  });

  it('handles live run with no record, no diary, and empty events', () => {
    const result = mergeRun('live-1', undefined, undefined, []);
    expect(result).toEqual({
      runId: 'live-1',
      events: {
        steps: 0,
        toolCalls: 0,
        gateBlocks: 0,
        gateBlockReasons: [],
        timeline: [],
      },
    });
  });
});
