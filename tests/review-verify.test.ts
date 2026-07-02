import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVerdicts, groundFindings, verifyFindings } from '../src/review/verify.js';
import type { Finding } from '../src/review/diff-review.js';
import type { Brain, BrainRequest } from '../src/brain/brain.js';
import type { BrainResponse } from '../src/loop/types.js';

const finding = (over: Partial<Finding> = {}): Finding => ({
  file: 'src/a.ts',
  severity: 'error',
  issue: 'off-by-one in loop bound',
  fix: 'use <= instead of <',
  ...over,
});

/** A canned-reply Brain: returns `text` for every complete() call. */
const fakeBrain = (text: string): Brain => ({
  id: 'fake',
  model: 'fake-model',
  complete: async (): Promise<BrainResponse> => ({
    text,
    toolCalls: [],
    stopReason: 'end_turn',
    usage: { input: 0, output: 0 },
  }),
});

describe('parseVerdicts', () => {
  it.each([
    ['plain confirmed/rejected array', '[{"index":0,"real":true},{"index":1,"real":false}]', [[0, true], [1, false]]],
    ['array wrapped in prose', 'Verdicts below:\n[{"index":2,"real":true}]\nDone.', [[2, true]]],
    ['fenced ```json block', '```json\n[{"index":0,"real":false}]\n```', [[0, false]]],
    ['non-boolean real is treated as rejected', '[{"index":0,"real":"true"},{"index":1,"real":1}]', [[0, false], [1, false]]],
    ['entries without a numeric index are skipped', '[{"index":"0","real":true},{"real":true},{"index":3,"real":true}]', [[3, true]]],
  ] as const)('%s', (_name, text, expected) => {
    expect([...parseVerdicts(text).entries()]).toEqual(expected);
  });

  it.each([
    ['empty string', ''],
    ['no JSON at all', 'I confirm finding 0 and reject finding 1.'],
    ['malformed JSON', '[{"index":0,"real":true'],
    ['a JSON object instead of an array', '{"index":0,"real":true}'],
  ])('returns an empty map for %s', (_name, text) => {
    expect(parseVerdicts(text).size).toBe(0);
  });
});

describe('groundFindings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pv-verify-'));
  writeFileSync(join(dir, 'real.ts'), 'line1\nline2\nline3\n'); // 4 split-lines (trailing \n)

  it('keeps a finding whose cited file exists and line is in range', async () => {
    const kept = await groundFindings(dir, [finding({ file: 'real.ts', line: 2 })]);
    expect(kept).toHaveLength(1);
  });

  it('keeps a finding with no line as long as the file exists', async () => {
    const kept = await groundFindings(dir, [finding({ file: 'real.ts', line: undefined })]);
    expect(kept).toHaveLength(1);
  });

  it('drops a finding that cites a nonexistent file (hallucinated reference)', async () => {
    const kept = await groundFindings(dir, [finding({ file: 'ghost.ts', line: 1 })]);
    expect(kept).toEqual([]);
  });

  it('drops line 0 and lines beyond EOF+1, keeps the EOF+1 boundary', async () => {
    const kept = await groundFindings(dir, [
      finding({ file: 'real.ts', line: 0, issue: 'zero' }),
      finding({ file: 'real.ts', line: 99, issue: 'way past eof' }),
      finding({ file: 'real.ts', line: 5, issue: 'eof+1 append point' }), // 4 lines → 5 allowed
    ]);
    expect(kept.map((f) => f.issue)).toEqual(['eof+1 append point']);
  });

  it('filters a mixed batch, preserving order of survivors', async () => {
    const kept = await groundFindings(dir, [
      finding({ file: 'real.ts', line: 1, issue: 'first' }),
      finding({ file: 'nope.ts', issue: 'gone' }),
      finding({ file: 'real.ts', issue: 'second' }),
    ]);
    expect(kept.map((f) => f.issue)).toEqual(['first', 'second']);
  });
});

describe('verifyFindings', () => {
  it('keeps only findings the skeptic confirms (confirm-path)', async () => {
    const findings = [finding({ issue: 'real bug' }), finding({ issue: 'speculative nit' })];
    const brain = fakeBrain('[{"index":0,"real":true},{"index":1,"real":false}]');
    const kept = await verifyFindings(findings, 'diff --git a/x b/x', brain);
    expect(kept.map((f) => f.issue)).toEqual(['real bug']);
  });

  it('drops everything when the skeptic rejects all (reject-path)', async () => {
    const findings = [finding(), finding({ issue: 'other' })];
    const brain = fakeBrain('[{"index":0,"real":false},{"index":1,"real":false}]');
    expect(await verifyFindings(findings, 'diff', brain)).toEqual([]);
  });

  it('drops findings the verdict list simply omits', async () => {
    const findings = [finding({ issue: 'judged' }), finding({ issue: 'unjudged' })];
    const brain = fakeBrain('[{"index":0,"real":true}]');
    const kept = await verifyFindings(findings, 'diff', brain);
    expect(kept.map((f) => f.issue)).toEqual(['judged']);
  });

  it('returns [] immediately for no findings without calling the brain', async () => {
    const complete = vi.fn();
    const brain: Brain = { id: 'f', model: 'm', complete };
    expect(await verifyFindings([], 'diff', brain)).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps all findings when the verifier reply is unparseable (fail-open)', async () => {
    const findings = [finding(), finding({ issue: 'other' })];
    const kept = await verifyFindings(findings, 'diff', fakeBrain('sorry, no JSON from me'));
    expect(kept).toEqual(findings);
  });

  it('keeps all findings when the brain call throws (fail-open)', async () => {
    const brain: Brain = {
      id: 'f',
      model: 'm',
      complete: async () => { throw new Error('api down'); },
    };
    const findings = [finding()];
    expect(await verifyFindings(findings, 'diff', brain)).toEqual(findings);
  });

  it('sends the skeptic a numbered finding list and the (truncated) diff', async () => {
    let seen: BrainRequest | null = null;
    const brain: Brain = {
      id: 'f',
      model: 'm',
      complete: async (req) => {
        seen = req;
        return { text: '[]', toolCalls: [], stopReason: 'end_turn', usage: { input: 0, output: 0 } };
      },
    };
    await verifyFindings(
      [finding({ file: 'x.ts', line: 7, severity: 'warn', issue: 'boom' })],
      'THE DIFF BODY',
      brain,
    );
    const text = seen!.messages[0].text!;
    expect(text).toContain('THE DIFF BODY');
    expect(text).toContain('0. [warn] x.ts:7 — boom');
    expect(seen!.system).toContain('skeptical');
  });
});
