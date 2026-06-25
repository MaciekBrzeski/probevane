import { describe, it, expect } from 'vitest';
import { formatEvent, parseEvents } from '../src/loop/events.js';
import type { LoopEvent } from '../src/loop/events.js';

const baseEvent: LoopEvent = {
  ts: '2024-01-15T10:00:00.000Z',
  runId: 'run-abc-123',
  step: 3,
  tool: 'write_file',
  toolCalls: 2,
  gateBlocks: 1,
  gateBlockReasons: ['red_first'],
  tokensIn: 1500,
  tokensOut: 420,
  editedFiles: ['src/foo.ts', 'tests/foo.test.ts'],
  stopReason: 'end_turn',
  accepted: true,
};

describe('formatEvent', () => {
  it('returns a string with no embedded newlines', () => {
    const line = formatEvent(baseEvent);
    expect(typeof line).toBe('string');
    expect(line).not.toContain('\n');
  });

  it('produces valid JSON', () => {
    const line = formatEvent(baseEvent);
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it('serialises all fields including optional ones', () => {
    const line = formatEvent(baseEvent);
    const parsed = JSON.parse(line) as LoopEvent;
    expect(parsed.ts).toBe(baseEvent.ts);
    expect(parsed.runId).toBe(baseEvent.runId);
    expect(parsed.step).toBe(baseEvent.step);
    expect(parsed.tool).toBe(baseEvent.tool);
    expect(parsed.toolCalls).toBe(baseEvent.toolCalls);
    expect(parsed.gateBlocks).toBe(baseEvent.gateBlocks);
    expect(parsed.gateBlockReasons).toEqual(baseEvent.gateBlockReasons);
    expect(parsed.tokensIn).toBe(baseEvent.tokensIn);
    expect(parsed.tokensOut).toBe(baseEvent.tokensOut);
    expect(parsed.editedFiles).toEqual(baseEvent.editedFiles);
    expect(parsed.stopReason).toBe(baseEvent.stopReason);
    expect(parsed.accepted).toBe(baseEvent.accepted);
  });
});

describe('parseEvents', () => {
  it('round-trips a single event through formatEvent then parseEvents', () => {
    const line = formatEvent(baseEvent);
    const results = parseEvents(line);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(baseEvent);
  });

  it('parses multiple valid events', () => {
    const ev2: LoopEvent = {
      ts: '2024-01-15T11:00:00.000Z',
      runId: 'run-xyz-456',
      step: 1,
      toolCalls: 0,
      gateBlocks: 0,
      tokensIn: 100,
      tokensOut: 50,
    };
    const text = [formatEvent(baseEvent), formatEvent(ev2)].join('\n');
    const results = parseEvents(text);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(baseEvent);
    expect(results[1]).toEqual(ev2);
  });

  it('silently skips malformed (non-JSON) lines', () => {
    const ev2: LoopEvent = {
      ts: '2024-01-15T11:00:00.000Z',
      runId: 'run-xyz-789',
      step: 2,
      toolCalls: 1,
      gateBlocks: 0,
      tokensIn: 200,
      tokensOut: 80,
    };
    const text = [
      formatEvent(baseEvent),
      '{this is not valid json}',
      '',
      formatEvent(ev2),
    ].join('\n');
    const results = parseEvents(text);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(baseEvent);
    expect(results[1]).toEqual(ev2);
  });

  it('returns empty array for empty string', () => {
    expect(parseEvents('')).toEqual([]);
  });

  it('returns empty array when all lines are malformed', () => {
    const text = 'not json\nalso not json\n{broken';
    expect(parseEvents(text)).toEqual([]);
  });
});
