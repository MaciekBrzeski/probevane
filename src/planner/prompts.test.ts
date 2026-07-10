import { describe, it, expect } from 'vitest';
import { parseSteps, fimPrefix, fimSuffix, chatUser } from './prompts.js';

describe('parseSteps', () => {
  it('parses a numbered list into ordered steps with folded detail', () => {
    const steps = parseSteps(
      '1. Add the route\n   wire it in router.ts\n2. Write the handler\n3. Add a test',
    );
    expect(steps.map((s) => s.title)).toEqual(['Add the route', 'Write the handler', 'Add a test']);
    expect(steps[0]!.detail).toBe('wire it in router.ts');
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it('renumbers when the model restarts or skips numbers', () => {
    const steps = parseSteps('1. a\n1. b\n5. c');
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(steps.map((s) => s.title)).toEqual(['a', 'b', 'c']);
  });

  it('accepts ")" delimiters and ignores non-step prose', () => {
    const steps = parseSteps('Here is the plan:\n1) first\n2) second\nDone.');
    expect(steps).toHaveLength(2);
    expect(steps[1]!.title).toBe('second');
  });

  it('returns [] for text with no numbered steps', () => {
    expect(parseSteps('no steps here')).toEqual([]);
  });
});

describe('prompt framing', () => {
  it('fim prefix ends mid-list (seeds "1. ") and embeds current state', () => {
    const p = fimPrefix('empty repo');
    expect(p).toContain('empty repo');
    expect(p.endsWith('1. ')).toBe(true);
  });

  it('fim suffix carries the desired state', () => {
    expect(fimSuffix('REST API')).toContain('REST API');
  });

  it('chat user prompt includes both states and an optional step budget', () => {
    const u = chatUser('A', 'B', 5);
    expect(u).toContain('A');
    expect(u).toContain('B');
    expect(u).toContain('about 5 steps');
  });
});
