import { describe, it, expect } from 'vitest';
import { fromApi } from '../src/brain/anthropic-sdk.js';

// fromApi maps both a create() response and a stream.finalMessage() — they share
// the Messages shape (content blocks + usage), so streaming returns the same
// BrainResponse. These cover the streaming-core assembly without a live call.
describe('fromApi (shared by create + stream.finalMessage)', () => {
  it('assembles text + tool calls + usage incl. cache fields', () => {
    const msg = {
      content: [
        { type: 'text', text: 'thinking… ' },
        { type: 'tool_use', id: 't1', name: 'write_file', input: { path: 'a.ts', contents: 'x' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 5 },
    };
    const r = fromApi(msg);
    expect(r.text).toBe('thinking… ');
    expect(r.toolCalls).toEqual([{ id: 't1', name: 'write_file', input: { path: 'a.ts', contents: 'x' } }]);
    expect(r.stopReason).toBe('tool_use');
    expect(r.usage).toMatchObject({ input: 100, output: 20, cacheRead: 80, cacheWrite: 5 });
  });

  it('maps end_turn + missing cache fields', () => {
    const r = fromApi({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    expect(r.stopReason).toBe('end_turn');
    expect(r.toolCalls).toEqual([]);
    expect(r.usage.cacheRead).toBe(0);
  });

  it('maps max_tokens stop reason', () => {
    const r = fromApi({ content: [], stop_reason: 'max_tokens', usage: { input_tokens: 0, output_tokens: 0 } });
    expect(r.stopReason).toBe('max_tokens');
  });
});
