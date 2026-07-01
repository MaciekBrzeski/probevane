// src/loop/transcript.test.ts
import { describe, it, expect } from 'vitest';
import { buildTurn, userTurn, formatTurn, parseTranscript } from './transcript';

describe('buildTurn', () => {
  it('builds a full assistant turn with all fields', () => {
    const turn = buildTurn({
      runId: 'run-1',
      step: 3,
      model: 'gpt-4',
      text: 'hello',
      toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      results: [{ id: 'call-1', content: 'content', isError: false }],
      usage: { input: 12, output: 5 },
      ts: '2024-01-02T03:04:05.000Z',
    });

    expect(turn).toEqual({
      ts: '2024-01-02T03:04:05.000Z',
      runId: 'run-1',
      step: 3,
      role: 'assistant',
      model: 'gpt-4',
      text: 'hello',
      toolCalls: [{ name: 'read_file', input: { path: 'a.ts' } }],
      toolResults: [{ name: 'read_file', ok: true, content: 'content' }],
      tokensIn: 12,
      tokensOut: 5,
    });
  });

  it('builds a minimal assistant turn with defaults', () => {
    const turn = buildTurn({ runId: 'run-2', step: 1 });

    expect(turn.runId).toBe('run-2');
    expect(turn.step).toBe(1);
    expect(turn.role).toBe('assistant');
    expect(turn.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(turn.model).toBeUndefined();
    expect(turn.text).toBeUndefined();
    expect(turn.toolCalls).toBeUndefined();
    expect(turn.toolResults).toBeUndefined();
    expect(turn.tokensIn).toBeUndefined();
    expect(turn.tokensOut).toBeUndefined();
  });

  it('maps multiple tool results to their call names', () => {
    const turn = buildTurn({
      runId: 'run-3',
      step: 2,
      toolCalls: [
        { id: 'a', name: 'read_file', input: { path: 'x.ts' } },
        { id: 'b', name: 'write_file', input: { path: 'y.ts', content: 'c' } },
      ],
      results: [
        { id: 'a', content: 'ok', isError: false },
        { id: 'b', content: 'done', isError: false },
      ],
    });

    expect(turn.toolResults).toEqual([
      { name: 'read_file', ok: true, content: 'ok' },
      { name: 'write_file', ok: true, content: 'done' },
    ]);
  });

  it('falls back to the result id when no matching call exists', () => {
    const turn = buildTurn({
      runId: 'run-4',
      step: 1,
      results: [{ id: 'orphan-1', content: 'x', isError: true }],
    });

    expect(turn.toolResults).toEqual([
      { name: 'orphan-1', ok: false, content: 'x' },
    ]);
  });

  it('omits empty arrays and empty text', () => {
    const turn = buildTurn({
      runId: 'run-5',
      step: 1,
      text: '',
      toolCalls: [],
      results: [],
    });

    expect(turn.text).toBeUndefined();
    expect(turn.toolCalls).toBeUndefined();
    expect(turn.toolResults).toBeUndefined();
  });

  it('uses provided timestamp instead of generating one', () => {
    const turn = buildTurn({ runId: 'run-6', step: 0, ts: '1999-12-31T23:59:59.000Z' });
    expect(turn.ts).toBe('1999-12-31T23:59:59.000Z');
  });
});

describe('userTurn', () => {
  it('creates a user turn at step 0 with provided values', () => {
    const turn = userTurn('run-u', 'do the thing', '2024-06-15T10:00:00.000Z');

    expect(turn).toEqual({
      ts: '2024-06-15T10:00:00.000Z',
      runId: 'run-u',
      step: 0,
      role: 'user',
      text: 'do the thing',
    });
  });

  it('defaults timestamp when not provided', () => {
    const turn = userTurn('run-v', 'task');
    expect(turn.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(turn.runId).toBe('run-v');
    expect(turn.step).toBe(0);
    expect(turn.role).toBe('user');
    expect(turn.text).toBe('task');
  });

  it('preserves empty text', () => {
    const turn = userTurn('run-w', '', '2024-01-01T00:00:00.000Z');
    expect(turn.text).toBe('');
  });
});

describe('formatTurn', () => {
  it('serializes a turn to compact JSON', () => {
    const turn = userTurn('run-f', 'hello', '2024-01-01T00:00:00.000Z');
    expect(formatTurn(turn)).toBe(
      '{"ts":"2024-01-01T00:00:00.000Z","runId":"run-f","step":0,"role":"user","text":"hello"}',
    );
  });

  it('round-trips through parseTranscript', () => {
    const turn = buildTurn({
      runId: 'run-g',
      step: 7,
      model: 'model-x',
      text: 'ok',
      usage: { input: 1, output: 2 },
      ts: '2024-02-02T02:02:02.000Z',
    });
    const parsed = parseTranscript(formatTurn(turn));
    expect(parsed).toEqual([turn]);
  });
});

describe('parseTranscript', () => {
  it('returns an empty array for empty input', () => {
    expect(parseTranscript('')).toEqual([]);
  });

  it('parses a single JSONL line', () => {
    const line = JSON.stringify({ ts: 't', runId: 'r', step: 1, role: 'assistant' });
    expect(parseTranscript(line)).toEqual([{ ts: 't', runId: 'r', step: 1, role: 'assistant' }]);
  });

  it('parses multiple lines and preserves order', () => {
    const lines = [
      JSON.stringify({ runId: 'r', step: 0, role: 'user', text: 'hi' }),
      JSON.stringify({ runId: 'r', step: 1, role: 'assistant', text: 'ok' }),
    ].join('\n');
    const parsed = parseTranscript(lines);
    expect(parsed[0].step).toBe(0);
    expect(parsed[1].step).toBe(1);
    expect(parsed).toHaveLength(2);
  });

  it('skips blank and whitespace-only lines', () => {
    const lines = ['', '  ', JSON.stringify({ runId: 'r', step: 1, role: 'assistant' }), ''].join(
      '\n',
    );
    expect(parseTranscript(lines)).toEqual([{ runId: 'r', step: 1, role: 'assistant' }]);
  });

  it('skips malformed and partial lines without throwing', () => {
    const good = JSON.stringify({ runId: 'r', step: 2, role: 'assistant' });
    const text = `${good}\n{partial\n\nnot-json\n${good}`;
    expect(parseTranscript(text)).toEqual([
      { runId: 'r', step: 2, role: 'assistant' },
      { runId: 'r', step: 2, role: 'assistant' },
    ]);
  });

  it('handles trailing newline', () => {
    const line = JSON.stringify({ runId: 'r', step: 3, role: 'user' });
    expect(parseTranscript(`${line}\n`)).toEqual([{ runId: 'r', step: 3, role: 'user' }]);
  });
});
