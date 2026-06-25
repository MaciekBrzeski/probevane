import { describe, it, expect } from 'vitest';
import { sseFrame, tailFrom, latestPerRun, runStatus } from './observe';
import type { LoopEvent } from './events';

// Minimal factory so every test only declares what it cares about.
function makeEvent(overrides: Partial<LoopEvent> & { runId: string; step: number }): LoopEvent {
  return {
    ts: '2024-01-01T00:00:00.000Z',
    toolCalls: 0,
    gateBlocks: 0,
    tokensIn: 0,
    tokensOut: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sseFrame
// ---------------------------------------------------------------------------
describe('sseFrame', () => {
  it('wraps a simple string in SSE data frame', () => {
    expect(sseFrame('hello')).toBe('data: hello\n\n');
  });

  it('wraps an empty string correctly', () => {
    expect(sseFrame('')).toBe('data: \n\n');
  });

  it('wraps a JSON payload without modification', () => {
    const payload = JSON.stringify({ event: 'tick', step: 3 });
    expect(sseFrame(payload)).toBe(`data: ${payload}\n\n`);
  });

  it('always ends with double newline', () => {
    const result = sseFrame('any payload');
    expect(result.endsWith('\n\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tailFrom
// ---------------------------------------------------------------------------
describe('tailFrom', () => {
  it('returns all non-empty lines and full length when offset is 0', () => {
    const content = 'a\nb\nc';
    const result = tailFrom(content, 0);
    expect(result.lines).toEqual(['a', 'b', 'c']);
    expect(result.offset).toBe(content.length);
  });

  it('returns only new lines when given a mid-content offset', () => {
    const content = 'line1\nline2\nline3';
    // offset points just after "line1\n" (6 bytes)
    const result = tailFrom(content, 6);
    expect(result.lines).toEqual(['line2', 'line3']);
    expect(result.offset).toBe(content.length);
  });

  it('returns empty lines array when offset equals content length', () => {
    const content = 'abc';
    const result = tailFrom(content, content.length);
    expect(result.lines).toEqual([]);
    expect(result.offset).toBe(content.length);
  });

  it('returns empty lines array when offset exceeds content length', () => {
    const content = 'abc';
    const result = tailFrom(content, 999);
    expect(result.lines).toEqual([]);
    expect(result.offset).toBe(content.length);
  });

  it('filters out empty strings produced by trailing newlines', () => {
    const content = 'foo\nbar\n';
    const result = tailFrom(content, 0);
    expect(result.lines).toEqual(['foo', 'bar']);
    expect(result.offset).toBe(content.length);
  });

  it('handles empty content string', () => {
    const result = tailFrom('', 0);
    expect(result.lines).toEqual([]);
    expect(result.offset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// latestPerRun
// ---------------------------------------------------------------------------
describe('latestPerRun', () => {
  it('returns an empty Map for an empty events array', () => {
    const m = latestPerRun([]);
    expect(m.size).toBe(0);
  });

  it('stores a single event under its runId', () => {
    const e = makeEvent({ runId: 'run-1', step: 1 });
    const m = latestPerRun([e]);
    expect(m.size).toBe(1);
    expect(m.get('run-1')).toMatchObject({ runId: 'run-1', step: 1 });
  });

  it('keeps separate entries for different runIds', () => {
    const e1 = makeEvent({ runId: 'run-A', step: 1 });
    const e2 = makeEvent({ runId: 'run-B', step: 2 });
    const m = latestPerRun([e1, e2]);
    expect(m.size).toBe(2);
    expect(m.get('run-A')?.step).toBe(1);
    expect(m.get('run-B')?.step).toBe(2);
  });

  it('later events overwrite earlier fields for the same runId', () => {
    const e1 = makeEvent({ runId: 'run-1', step: 1, tool: 'read_file' });
    const e2 = makeEvent({ runId: 'run-1', step: 2, tool: 'write_file', stopReason: 'end_turn' });
    const m = latestPerRun([e1, e2]);
    expect(m.size).toBe(1);
    const merged = m.get('run-1')!;
    expect(merged.step).toBe(2);
    expect(merged.tool).toBe('write_file');
    expect(merged.stopReason).toBe('end_turn');
  });

  it('preserves fields from earlier event that are absent in later event', () => {
    const e1 = makeEvent({ runId: 'run-1', step: 1, tool: 'read_file' });
    // e2 has no `tool` field set; spread merge keeps e1's tool
    const e2 = makeEvent({ runId: 'run-1', step: 2 });
    const m = latestPerRun([e1, e2]);
    const merged = m.get('run-1')!;
    // step updated
    expect(merged.step).toBe(2);
    // tool preserved from e1 because e2 doesn't override it
    expect(merged.tool).toBe('read_file');
  });
});

// ---------------------------------------------------------------------------
// runStatus
// ---------------------------------------------------------------------------
describe('runStatus', () => {
  it('returns "▶ step N" when there is no stopReason', () => {
    const e = makeEvent({ runId: 'r', step: 5 });
    expect(runStatus(e)).toBe('▶ step 5');
  });

  it('returns "✅ accepted" when stopReason is set and accepted is true', () => {
    const e = makeEvent({ runId: 'r', step: 3, stopReason: 'end_turn', accepted: true });
    expect(runStatus(e)).toBe('✅ accepted');
  });

  it('returns "🛑 <stopReason>" when stopReason is set and accepted is false', () => {
    const e = makeEvent({ runId: 'r', step: 3, stopReason: 'max_tokens', accepted: false });
    expect(runStatus(e)).toBe('🛑 max_tokens');
  });

  it('returns "🛑 <stopReason>" when stopReason is set and accepted is undefined', () => {
    const e = makeEvent({ runId: 'r', step: 2, stopReason: 'tool_error' });
    expect(runStatus(e)).toBe('🛑 tool_error');
  });

  it('reflects the exact step number in running status', () => {
    const e = makeEvent({ runId: 'r', step: 42 });
    expect(runStatus(e)).toBe('▶ step 42');
  });
});
