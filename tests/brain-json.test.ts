import { describe, it, expect } from 'vitest';
import { extractJsonValue, extractJsonStrict } from '../src/brain/json.js';
import { parseDecision } from '../src/brain/claude-code.js';
import { parseFindings } from '../src/review/diff-review.js';
import { parseVerdicts } from '../src/review/verify.js';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isArr = (x: unknown): x is unknown[] => Array.isArray(x);

describe('extractJsonValue', () => {
  it('reads a ```json fenced object (ignoring prose)', () => {
    expect(extractJsonValue('here:\n```json\n{"a":1}\n```\nthanks')).toEqual({ a: 1 });
  });
  it('reads a balanced object embedded in prose', () => {
    expect(extractJsonValue('result {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
  });
  it('reads a top-level array', () => {
    expect(extractJsonValue('[{"x":1},{"x":2}]')).toEqual([{ x: 1 }, { x: 2 }]);
  });
  it('is string-aware (braces inside strings do not break it)', () => {
    expect(extractJsonValue('{"s":"a } b { c"}')).toEqual({ s: 'a } b { c' });
  });
  it('null on no JSON / malformed', () => {
    expect(extractJsonValue('no json here')).toBeNull();
    expect(extractJsonValue('{bad json,,}')).toBeNull();
  });
});

describe('extractJsonStrict', () => {
  it('null when the value fails the type guard', () => {
    expect(extractJsonStrict('[1,2]', isObj)).toBeNull();
    expect(extractJsonStrict('{"a":1}', isArr)).toBeNull();
  });
  it('returns the validated value', () => {
    expect(extractJsonStrict('{"a":1}', isObj)).toEqual({ a: 1 });
  });
});

describe('refactored parsers (accept good, reject garbage)', () => {
  it('parseDecision extracts tool calls + text', () => {
    const d = parseDecision('```json\n{"text":"ok","tool_calls":[{"name":"write_file","input":{"path":"a"}}]}\n```');
    expect(d.text).toBe('ok');
    expect(d.toolCalls).toEqual([{ id: 'cc-0', name: 'write_file', input: { path: 'a' } }]);
  });
  it('parseDecision falls back to prose when no JSON', () => {
    expect(parseDecision('just prose').toolCalls).toEqual([]);
  });
  it('parseFindings keeps valid findings, drops malformed', () => {
    const f = parseFindings('[{"file":"a.ts","issue":"bug","severity":"error"},{"nope":1}]');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ file: 'a.ts', issue: 'bug', severity: 'error' });
  });
  it('parseFindings → [] on garbage', () => {
    expect(parseFindings('no array here')).toEqual([]);
  });
  it('parseVerdicts maps index→real', () => {
    const m = parseVerdicts('[{"index":0,"real":true},{"index":1,"real":false}]');
    expect(m.get(0)).toBe(true);
    expect(m.get(1)).toBe(false);
  });
});
