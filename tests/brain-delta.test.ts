import { describe, it, expect } from 'vitest';
import { flushBuffer } from '../src/brain/anthropic-sdk.js';
import { formatEvent, parseEvents } from '../src/loop/events.js';

describe('flushBuffer (delta throttle)', () => {
  it('emits >=flushAt-char chunks and keeps the remainder', () => {
    const { chunks, rest } = flushBuffer('a'.repeat(450), 200);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.length === 200)).toBe(true);
    expect(rest.length).toBe(50);
  });
  it('holds short buffers (no chunk until threshold)', () => {
    const { chunks, rest } = flushBuffer('short', 200);
    expect(chunks).toEqual([]);
    expect(rest).toBe('short');
  });
  it('reassembles exactly (chunks + rest = input)', () => {
    const input = 'x'.repeat(523);
    const { chunks, rest } = flushBuffer(input, 100);
    expect(chunks.join('') + rest).toBe(input);
  });
});

describe('delta event round-trip', () => {
  it('formatEvent/parseEvents preserve a delta chunk', () => {
    const line = formatEvent({ ts: 't', runId: 'r', step: 3, toolCalls: 0, gateBlocks: 0, tokensIn: 0, tokensOut: 0, delta: 'partial output…' });
    const [ev] = parseEvents(line);
    expect(ev.delta).toBe('partial output…');
    expect(ev.step).toBe(3);
  });
});
