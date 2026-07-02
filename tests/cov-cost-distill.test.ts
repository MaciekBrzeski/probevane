import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Pure modules — safe to import statically (no env-dependent side effects at call).
import {
  projectLedger,
  isFreeRun,
  formatProjection,
  PROJECTION_MODELS,
  type Projection,
} from '../src/cost/project.js';
import { simulateCost, savings, formatReport, MEASURED } from '../src/cost/simulate.js';
import { summarize as summarizeLedger, type RunRecord } from '../src/cost/ledger.js';
import {
  estimateTokens,
  estimateRequestTokens,
  estimateOutputTokens,
} from '../src/cost/estimate.js';
import { spentSince, overCap } from '../src/cost/budget.js';
import { stripFences, basePrompt, baseValue, cpuGenerate } from '../src/distill/bases.js';
import { parseDirective, htmlToText } from '../src/integrations/ado.js';
import { costOf } from '../src/cost/pricing.js';

// ---------------------------------------------------------------------------
// temp-dir bookkeeping + env snapshot
// ---------------------------------------------------------------------------
const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'pv-cov-'));
  tmpDirs.push(d);
  return d;
}
const envSnapshot = { ...process.env };

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  // restore any env keys we touch
  for (const k of ['PROBEVANE_STATE', 'PROBEVANE_LEDGER']) {
    if (k in envSnapshot) process.env[k] = envSnapshot[k];
    else delete process.env[k];
  }
  vi.resetModules();
});

const baseRec = (over: Partial<RunRecord> = {}): RunRecord => ({
  ts: '2024-01-01T00:00:00Z',
  runId: 'r',
  label: 'generate:fixtures/a',
  model: 'bridge',
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cost: 0,
  accepted: true,
  tookOver: false,
  stopReason: 'accept',
  steps: 1,
  ...over,
});

// ===========================================================================
// src/cost/project.ts
// ===========================================================================
describe('cost/project', () => {
  it('isFreeRun: $0 (bridge/local/replay/unknown) vs billed models', () => {
    expect(isFreeRun({ model: 'bridge' })).toBe(true);
    expect(isFreeRun({ model: 'local:qwen2.5-coder' })).toBe(true);
    expect(isFreeRun({ model: 'replay:foo' })).toBe(true);
    expect(isFreeRun({ model: 'claude-haiku-4-5' })).toBe(false);
    expect(isFreeRun({ model: 'claude-opus-4-8' })).toBe(false);
  });

  it('projectLedger sums only $0-run tokens and reprices per model', () => {
    const p = projectLedger([
      baseRec({ model: 'bridge', tokensIn: 100_000, tokensOut: 10_000 }),
      baseRec({ model: 'local:qwen', tokensIn: 50_000, tokensOut: 5_000 }),
      baseRec({ model: 'claude-opus-4-8', tokensIn: 999, tokensOut: 999 }), // billed → skipped
    ]);
    expect(p.freeRuns).toBe(2);
    expect(p.tokensIn).toBe(150_000);
    expect(p.tokensOut).toBe(15_000);
    expect(p.byModel['claude-haiku-4-5']).toBe(
      costOf('claude-haiku-4-5', { input: 150_000, output: 15_000 }),
    );
    // opus > sonnet > haiku for identical volume
    expect(p.byModel['claude-opus-4-8']).toBeGreaterThan(p.byModel['claude-sonnet-4-6']!);
    expect(p.byModel['claude-sonnet-4-6']).toBeGreaterThan(p.byModel['claude-haiku-4-5']!);
  });

  it('projectLedger with no free runs → zeros, every model priced at $0', () => {
    const p = projectLedger([baseRec({ model: 'claude-haiku-4-5', tokensIn: 5000, tokensOut: 500 })]);
    expect(p.freeRuns).toBe(0);
    expect(p.tokensIn).toBe(0);
    expect(p.tokensOut).toBe(0);
    for (const m of PROJECTION_MODELS) expect(p.byModel[m]).toBe(0);
  });

  it('projectLedger respects a custom model list', () => {
    const p = projectLedger([baseRec({ tokensIn: 1000, tokensOut: 100 })], ['claude-opus-4-8']);
    expect(Object.keys(p.byModel)).toEqual(['claude-opus-4-8']);
    expect(p.byModel['claude-opus-4-8']).toBeGreaterThan(0);
  });

  it('formatProjection renders the header + a line per model', () => {
    const p: Projection = {
      freeRuns: 2,
      tokensIn: 150_000,
      tokensOut: 15_000,
      byModel: { 'claude-haiku-4-5': 0.225 },
    };
    const out = formatProjection(p);
    expect(out).toContain('Cost projection');
    expect(out).toContain('2 $0 run(s)');
    expect(out).toContain('150.0k in / 15.0k out');
    expect(out).toContain('claude-haiku-4-5');
    expect(out).toContain('≈ $0.2250');
  });
});

// ===========================================================================
// src/cost/simulate.ts
// ===========================================================================
describe('cost/simulate', () => {
  it('simulateCost: default hit-rate strategies + measured math', () => {
    const rows = simulateCost({ easy: 10, hard: 5 }); // default localHitRate 0.5
    const E = MEASURED.easyApi, H = MEASURED.hardApi;
    expect(rows[0]).toMatchObject({ name: 'all-api', cost: Math.round((10 * E + 5 * H) * 100) / 100 });
    expect(rows[0].cost).toBe(5.7);
    expect(rows[1].cost).toBe(4.9); // 10*0.5*0.16 + 5*0.82
    expect(rows[1].name).toContain('hybrid');
    expect(rows[1].note).toContain('50%');
    expect(rows[2]).toMatchObject({ name: 'bridge / local-only', cost: 0 });
  });

  it('simulateCost clamps localHitRate below 0 (→ hybrid == all-api)', () => {
    const rows = simulateCost({ easy: 10, hard: 5 }, -1);
    expect(rows[1].cost).toBe(rows[0].cost); // r=0: no easy cleared locally
    expect(rows[1].note).toContain('0%');
  });

  it('simulateCost clamps localHitRate above 1 (→ all easy free)', () => {
    const rows = simulateCost({ easy: 10, hard: 5 }, 2);
    expect(rows[1].cost).toBe(Math.round(5 * MEASURED.hardApi * 100) / 100); // only hard billed
    expect(rows[1].note).toContain('100%');
  });

  it('savings computes savedVsBaseline + pct against the first strategy', () => {
    const rows = savings(simulateCost({ easy: 10, hard: 5 }));
    expect(rows[0].savedVsBaseline).toBe(0);
    expect(rows[0].pct).toBe(0); // baseline vs itself
    expect(rows[1].savedVsBaseline).toBe(0.8); // 5.7 - 4.9
    expect(rows[1].pct).toBe(14); // round(0.8/5.7*100)
    expect(rows[2].savedVsBaseline).toBe(5.7);
    expect(rows[2].pct).toBe(100);
  });

  it('savings with a $0 baseline → pct 0 everywhere (base>0 false branch)', () => {
    const rows = savings(simulateCost({ easy: 0, hard: 0 }));
    expect(rows[0].cost).toBe(0);
    for (const r of rows) expect(r.pct).toBe(0);
  });

  it('savings on an empty strategy list → [] (base default 0)', () => {
    expect(savings([])).toEqual([]);
  });

  it('formatReport renders header, measured note, and a row per strategy', () => {
    const out = formatReport({ easy: 3, hard: 2 }, 0.5);
    expect(out).toContain('Cost simulation — 3 easy + 2 hard module(s)');
    expect(out).toContain('local hit-rate 50%');
    expect(out).toContain(`easy≈$${MEASURED.easyApi}`);
    expect(out).toContain('all-api');
    expect(out).toContain('bridge / local-only');
  });
});

// ===========================================================================
// src/cost/estimate.ts  (drive every nullish branch)
// ===========================================================================
describe('cost/estimate', () => {
  it('estimateTokens: empty → 0, else ceil(len / 3.5)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('x'.repeat(35))).toBe(10);
    expect(estimateTokens('x'.repeat(36))).toBe(11); // ceil rounds up
  });

  it('estimateRequestTokens: undefined system + empty everything → 0', () => {
    expect(
      estimateRequestTokens({ system: undefined as unknown as string, messages: [], tools: [] }),
    ).toBe(0);
  });

  it('estimateRequestTokens: a tool with no inputSchema (inputSchema ?? {})', () => {
    const n = estimateRequestTokens({
      system: '',
      messages: [],
      tools: [{ name: 't', description: 'd', inputSchema: undefined as unknown as Record<string, unknown> }],
    });
    // chars = 't'.length(1) + 'd'.length(1) + '{}'.length(2) = 4 → ceil(4/3.5)=2
    expect(n).toBe(2);
  });

  it('estimateRequestTokens: msg with no text + empty toolResult content (content ?? "")', () => {
    const n = estimateRequestTokens({
      system: '',
      messages: [
        { role: 'user', toolResults: [{ id: 'a', content: undefined as unknown as string, isError: false }] },
      ],
      tools: [],
    });
    // 0 chars of content → ceil(0/3.5)=0 + 1 msg * MSG_OVERHEAD(4) = 4
    expect(n).toBe(4);
  });

  it('estimateRequestTokens: real system + transcript + schema exceeds bare overhead', () => {
    const n = estimateRequestTokens({
      system: 'you are a tester',
      messages: [
        { role: 'user', text: 'write a test for foo' },
        {
          role: 'assistant',
          text: 'on it',
          toolCalls: [{ id: 'c1', name: 'write_file', input: { path: 'foo.test.ts', body: 'x'.repeat(40) } }],
        },
      ],
      tools: [{ name: 'write_file', description: 'write a file to disk', inputSchema: { type: 'object' } }],
    });
    expect(n).toBeGreaterThan(8); // 2 msgs overhead + real content
  });

  it('estimateOutputTokens: undefined text → 0; tool-call input undefined (input ?? {})', () => {
    expect(estimateOutputTokens(undefined as unknown as string, [])).toBe(0);
    const n = estimateOutputTokens('', [
      { id: 'c', name: 'write', input: undefined as unknown as Record<string, unknown> },
    ]);
    // 'write'.length(5) + '{}'.length(2) = 7 → ceil(7/3.5)=2
    expect(n).toBe(2);
  });

  it('estimateOutputTokens: text + tool calls > text alone', () => {
    const withCall = estimateOutputTokens('done', [{ id: 'a', name: 'write', input: { path: 'x.ts' } }]);
    const textOnly = estimateOutputTokens('done', []);
    expect(withCall).toBeGreaterThan(textOnly);
    expect(textOnly).toBe(estimateTokens('done'));
  });
});

// ===========================================================================
// src/cost/budget.ts  (every conditional both ways)
// ===========================================================================
describe('cost/budget', () => {
  const recs: RunRecord[] = [
    baseRec({ ts: '2024-01-01T00:00:00Z', cost: 1 }),
    baseRec({ ts: '2024-01-02T00:00:00Z', cost: 2 }),
    baseRec({ ts: 'not-a-date', cost: 99 }), // Date.parse → NaN → 0
  ];

  it('spentSince includes only records inside [since, now]; invalid ts → epoch 0 (excluded)', () => {
    const since = Date.parse('2024-01-01T12:00:00Z');
    const now = Date.parse('2024-01-02T12:00:00Z');
    // r1 before window, r2 inside, r3 ts=0 < since → only r2
    expect(spentSince(recs, since, now)).toBe(2);
  });

  it('spentSince: wide window from epoch sweeps everything incl. the ts=0 record', () => {
    const now = Date.parse('2024-01-03T00:00:00Z');
    expect(spentSince(recs, 0, now)).toBe(102); // 1 + 2 + 99 (t=0 >= 0)
  });

  it('spentSince: empty ledger → 0', () => {
    expect(spentSince([], 0, Date.now())).toBe(0);
  });

  it('overCap: no cap (0 / negative) → always false', () => {
    const now = Date.parse('2024-01-04T00:00:00Z');
    expect(overCap(recs, 0, 24 * 400, now)).toBe(false);
    expect(overCap(recs, -5, 24 * 400, now)).toBe(false);
  });

  it('overCap: positive cap, spend under → false; spend at/over → true', () => {
    const now = Date.parse('2024-01-04T00:00:00Z');
    // ~400 days window covers Jan 1+2 (spend 3) but the ts=0 record falls before it
    expect(overCap(recs, 1000, 24 * 400, now)).toBe(false); // 3 < 1000
    expect(overCap(recs, 2, 24 * 400, now)).toBe(true); // 3 >= 2
    expect(overCap(recs, 3, 24 * 400, now)).toBe(true); // exactly at cap
  });
});

// ===========================================================================
// src/distill/bases.ts  (pure parts; ollama /api/chat spawn left untested)
// ===========================================================================
describe('distill/bases', () => {
  it('stripFences: pulls code out of a fenced block', () => {
    expect(stripFences('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
    expect(stripFences('prose\n```\nbody\n```\ntrailing')).toBe('body');
  });

  it('stripFences: no fence → trimmed text unchanged', () => {
    expect(stripFences('  const a = 1;  ')).toBe('const a = 1;');
  });

  it('baseValue: not green → hard -1 gate', () => {
    expect(baseValue({ green: false, tests: 99, coverage: 100, auditErrors: 0 })).toBe(-1);
  });

  it('baseValue: green → coverage + tests*5 - auditErrors*10', () => {
    expect(baseValue({ green: true, tests: 4, coverage: 80, auditErrors: 1 })).toBe(80 + 20 - 10);
    expect(baseValue({ green: true, tests: 0, coverage: 0, auditErrors: 0 })).toBe(0);
  });

  it('baseValue ranks model results; ties keep array order on a stable sort', () => {
    const results = [
      { model: 'a', green: true, tests: 2, coverage: 50, auditErrors: 0 }, // 60
      { model: 'b', green: false, tests: 9, coverage: 99, auditErrors: 0 }, // -1
      { model: 'c', green: true, tests: 4, coverage: 60, auditErrors: 0 }, // 80
      { model: 'd', green: true, tests: 2, coverage: 50, auditErrors: 0 }, // 60 (tie with a)
    ];
    const ranked = [...results].sort((x, y) => baseValue(y) - baseValue(x));
    expect(ranked[0].model).toBe('c'); // top score 80
    expect(ranked.at(-1)!.model).toBe('b'); // failed gate last
    // tie a vs d both 60 → preserved relative order (a before d)
    const tie = ranked.filter((r) => baseValue(r) === 60).map((r) => r.model);
    expect(tie).toEqual(['a', 'd']);
  });

  it('baseValue: empty result set → empty ranking (no pick)', () => {
    const ranked = ([] as Array<Parameters<typeof baseValue>[0] & { model: string }>).sort(
      (x, y) => baseValue(y) - baseValue(x),
    );
    expect(ranked).toEqual([]);
  });

  it('basePrompt embeds the read source + instruction', async () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'mod.ts'), 'export const x = 1;\n');
    const prompt = await basePrompt(dir, 'mod.ts', 'Write vitest tests.');
    expect(prompt).toContain('Source mod.ts:');
    expect(prompt).toContain('export const x = 1;');
    expect(prompt).toContain('Write vitest tests.');
  });

  it('basePrompt: missing source file → empty source body (read catch branch)', async () => {
    const dir = mkTmp();
    const prompt = await basePrompt(dir, 'does-not-exist.ts', 'Test it.');
    expect(prompt).toContain('Source does-not-exist.ts:\n\n\n\nTest it.');
  });
});

// ===========================================================================
// src/distill/bases.ts cpuGenerate — ollama /api/chat via a STUBBED global
// fetch (no network, no model). Only the HTTP shape + response math is real.
// ===========================================================================
describe('distill/bases cpuGenerate (stubbed fetch)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body, text: async () => '' }) as unknown as Response;

  it('happy path: forces CPU (num_gpu=0), returns text + tokPerSec from eval stats', async () => {
    let captured: { url: string; body: any } | undefined;
    vi.stubGlobal('fetch', async (url: any, init: any) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return ok({ message: { content: '```ts\nconst t = 1;\n```' }, eval_count: 100, eval_duration: 2e9 });
    });
    const r = await cpuGenerate('qwen2.5-coder:3b', 'sys prompt', 'user prompt');
    expect(r.text).toBe('```ts\nconst t = 1;\n```');
    expect(r.tokPerSec).toBe(50); // 100 tokens / 2s
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(captured!.url).toContain('/api/chat');
    expect(captured!.body.model).toBe('qwen2.5-coder:3b');
    expect(captured!.body.stream).toBe(false);
    expect(captured!.body.options).toEqual({ num_gpu: 0, num_predict: 700, temperature: 0.1 });
    expect(captured!.body.messages).toEqual([
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  it('passes a custom numPredict through to options.num_predict', async () => {
    let opts: any;
    vi.stubGlobal('fetch', async (_u: any, init: any) => {
      opts = JSON.parse(init.body).options;
      return ok({ message: { content: 'x' } });
    });
    await cpuGenerate('m', 's', 'u', 123);
    expect(opts.num_predict).toBe(123);
  });

  it('missing message/eval stats → empty text + tokPerSec 0 (nullish branches)', async () => {
    vi.stubGlobal('fetch', async () => ok({}));
    const r = await cpuGenerate('m', 's', 'u');
    expect(r.text).toBe('');
    expect(r.tokPerSec).toBe(0);
  });

  it('HTTP error → throws "<model>: <status> <body>"', async () => {
    vi.stubGlobal('fetch', async () =>
      ({ ok: false, status: 404, text: async () => 'model not found' }) as unknown as Response);
    await expect(cpuGenerate('ghost-model', 's', 'u')).rejects.toThrow('ghost-model: 404 model not found');
  });

  it('HTTP error with an unreadable body still throws with the status (text catch → "")', async () => {
    vi.stubGlobal('fetch', async () =>
      ({ ok: false, status: 500, text: async () => { throw new Error('torn'); } }) as unknown as Response);
    await expect(cpuGenerate('m', 's', 'u')).rejects.toThrow('m: 500 ');
  });
});

// ===========================================================================
// src/integrations/ado.ts  (PURE parsers only; adoClient fetch glue skipped)
// ===========================================================================
describe('integrations/ado htmlToText', () => {
  it('strips tags and turns block boundaries into newlines', () => {
    expect(htmlToText('<div>line one<br>line two</div>')).toBe('line one\nline two\n');
    expect(htmlToText('<p>a</p><p>b</p>')).toBe('a\nb\n');
    expect(htmlToText('<li>x</li>')).toBe('x\n');
  });

  it('decodes the common HTML entities', () => {
    expect(htmlToText('say &quot;hi&quot;')).toBe('say "hi"');
    expect(htmlToText('a &amp; b')).toBe('a & b');
    expect(htmlToText('1 &lt; 2 &gt; 0')).toBe('1 < 2 > 0');
    expect(htmlToText("it&#39;s &apos;quoted&apos;")).toBe("it's 'quoted'");
    expect(htmlToText('gap&nbsp;here')).toBe('gap here');
    expect(htmlToText('&#34;num&#34;')).toBe('"num"');
  });

  it('decodes numeric entities and does not re-introduce & last', () => {
    expect(htmlToText('&#65;&#66;&#67;')).toBe('ABC');
    // &amp;lt; → decode &amp; LAST so we get "&lt;" not "<"
    expect(htmlToText('&amp;lt;')).toBe('&lt;');
  });

  it('plain text with no tags/entities passes through', () => {
    expect(htmlToText('just words')).toBe('just words');
  });
});

describe('integrations/ado parseDirective', () => {
  it('parses a tagged generate directive with --kind + --only', () => {
    const d = parseDirective('[probevane] generate fixtures/react-todo --kind unit --only Foo.tsx')!;
    expect(d).toMatchObject({
      command: 'generate',
      dir: 'fixtures/react-todo',
      kind: 'unit',
      only: 'Foo.tsx',
    });
  });

  it('parses fix with a double-quoted --task from an HTML description', () => {
    const d = parseDirective('probevane: fix ./app', 'fix ./app --task &quot;handle the null case&quot;')!;
    expect(d.command).toBe('fix');
    expect(d.dir).toBe('./app');
    expect(d.task).toBe('handle the null case');
  });

  it('parses a single-quoted --task', () => {
    const d = parseDirective("[probevane] refactor src --task 'extract the helper'")!;
    expect(d.command).toBe('refactor');
    expect(d.task).toBe('extract the helper');
  });

  it('falls back to the rest-of-line task on a TRUNCATED description (lost closing quote)', () => {
    const d = parseDirective(
      '[probevane] feature .',
      'feature . --kind unit --task &quot;add a long blink module that got cut off',
    )!;
    expect(d.command).toBe('feature');
    expect(d.task).toBe('add a long blink module that got cut off');
  });

  it('detects e2e kind, else defaults to unit', () => {
    expect(parseDirective('generate ./app --kind e2e')!.kind).toBe('e2e');
    expect(parseDirective('generate ./app e2e')!.kind).toBe('e2e');
    expect(parseDirective('generate ./app')!.kind).toBe('unit');
  });

  it('defaults dir to "." when no path token follows the command', () => {
    const d = parseDirective('[probevane] repair')!;
    expect(d.dir).toBe('.');
    expect(d.kind).toBe('unit');
    expect(d.only).toBeUndefined();
    expect(d.task).toBeUndefined();
  });

  it('finds a command embedded in free text', () => {
    const d = parseDirective('Buy milk and fix the sink')!;
    expect(d.command).toBe('fix');
  });

  it('returns null when no command word is present', () => {
    expect(parseDirective('Buy milk for the office')).toBeNull();
    expect(parseDirective('', '')).toBeNull();
  });
});

// ===========================================================================
// src/cost/ledger.ts  (recordRun/readRuns roundtrip via temp PROBEVANE_STATE;
//                      summarize rollups are pure)
// ===========================================================================
async function freshLedger() {
  vi.resetModules();
  return import('../src/cost/ledger.js');
}

describe('cost/ledger recordRun + readRuns (temp state)', () => {
  it('appends a run and reads it back, pricing cost from tokens', async () => {
    const dir = mkTmp();
    process.env.PROBEVANE_STATE = dir;
    delete process.env.PROBEVANE_LEDGER;
    const mod = await freshLedger();
    await mod.recordRun({
      ts: 't', runId: 'r1', label: 'generate:fixtures/a', model: 'claude-haiku-4-5',
      tokensIn: 1000, tokensOut: 100, cacheRead: 0,
      accepted: true, tookOver: false, stopReason: 'accept', steps: 3,
    });
    const runs = await mod.readRuns();
    expect(runs).toHaveLength(1);
    // (1000*1 + 100*5) / 1e6 = 0.0015
    expect(runs[0].cost).toBe(0.0015);
    expect(runs[0].model).toBe('claude-haiku-4-5');
  });

  it('prefers a brain-reported costUsd over priced-from-tokens', async () => {
    const dir = mkTmp();
    process.env.PROBEVANE_STATE = dir;
    delete process.env.PROBEVANE_LEDGER;
    const mod = await freshLedger();
    await mod.recordRun({
      ts: 't', runId: 'r2', label: 'fix:fixtures/b', model: 'claude-sonnet-4-6',
      tokensIn: 9999, tokensOut: 9999, cacheRead: 0, costUsd: 0.5,
      accepted: false, tookOver: false, stopReason: 'budget', steps: 9,
    });
    const runs = await mod.readRuns();
    expect(runs[0].cost).toBe(0.5);
  });

  it('PROBEVANE_LEDGER=0 disables recording (no-op)', async () => {
    const dir = mkTmp();
    process.env.PROBEVANE_STATE = dir;
    const mod = await freshLedger();
    process.env.PROBEVANE_LEDGER = '0';
    await mod.recordRun({
      ts: 't', runId: 'r3', label: 'generate:x', model: 'bridge',
      tokensIn: 100, tokensOut: 10, cacheRead: 0,
      accepted: true, tookOver: false, stopReason: 'accept', steps: 1,
    });
    expect(await mod.readRuns()).toEqual([]);
  });

  it('readRuns on a missing ledger → [] ', async () => {
    const dir = mkTmp();
    process.env.PROBEVANE_STATE = dir;
    const mod = await freshLedger();
    expect(await mod.readRuns()).toEqual([]);
  });

  it('readRuns(path) reads an explicit file and skips torn/blank lines', async () => {
    const dir = mkTmp();
    const file = join(dir, 'runs.jsonl');
    const good = JSON.stringify(baseRec({ runId: 'a', cost: 0.1 }));
    const good2 = JSON.stringify(baseRec({ runId: 'b', cost: 0.2 }));
    writeFileSync(file, `${good}\n{ this is not json\n\n${good2}\n`);
    const mod = await freshLedger();
    const runs = await mod.readRuns(file);
    expect(runs.map((r) => r.runId)).toEqual(['a', 'b']);
  });
});

describe('cost/ledger summarize', () => {
  it('empty ledger → all-zero summary, acceptRate 0', () => {
    const s = summarizeLedger([]);
    expect(s).toMatchObject({
      runs: 0, totalCost: 0, totalTokensIn: 0, totalTokensOut: 0,
      accepted: 0, acceptRate: 0, harnessOnly: 0, withTakeover: 0, needsHand: 0,
    });
    expect(s.byModel).toEqual({});
    expect(s.byPath).toEqual({});
  });

  it('rolls up totals, the harness/takeover/hand split, and per-model/per-path buckets', () => {
    const s = summarizeLedger([
      baseRec({ model: 'claude-haiku-4-5', label: 'generate:fixtures/a', tokensIn: 1000, tokensOut: 100, cost: 0.01, accepted: true, tookOver: false }),
      baseRec({ model: 'claude-haiku-4-5', label: 'generate:fixtures/a', tokensIn: 2000, tokensOut: 200, cost: 0.02, accepted: true, tookOver: true }),
      baseRec({ model: 'claude-sonnet-4-6', label: 'fix:fixtures/b', tokensIn: 3000, tokensOut: 300, cost: 0.03, accepted: false, tookOver: false }),
    ]);
    expect(s.runs).toBe(3);
    expect(s.totalCost).toBe(0.06);
    expect(s.totalTokensIn).toBe(6000);
    expect(s.totalTokensOut).toBe(600);
    expect(s.accepted).toBe(2);
    expect(s.acceptRate).toBe(0.667); // +(2/3).toFixed(3)
    expect(s.harnessOnly).toBe(1); // accepted, no takeover
    expect(s.withTakeover).toBe(1); // accepted via takeover
    expect(s.needsHand).toBe(1); // not accepted
    expect(s.byModel).toEqual({
      'claude-haiku-4-5': { runs: 2, cost: 0.03 },
      'claude-sonnet-4-6': { runs: 1, cost: 0.03 },
    });
    expect(s.byPath).toEqual({
      generate: { runs: 2, cost: 0.03, accepted: 2 },
      fix: { runs: 1, cost: 0.03, accepted: 0 },
    });
  });

  it('rounds totalCost to micro-dollars (float-sum guard)', () => {
    const s = summarizeLedger([
      baseRec({ cost: 0.1 }),
      baseRec({ cost: 0.2 }),
    ]);
    expect(s.totalCost).toBe(0.3); // not 0.30000000000000004
  });
});

describe('cost/ledger summarize — duration rollup', () => {
  const base: RunRecord = {
    ts: '2026-06-27T10:00:00.000Z', runId: 'r1', label: 'generate:app', model: 'm',
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cost: 0, accepted: true, tookOver: false,
    stopReason: 'accepted', steps: 1,
  };
  it('averages only over runs that recorded a duration', () => {
    const s = summarizeLedger([
      { ...base, durationMs: 1000 },
      { ...base, runId: 'r2', durationMs: 3000 },
      { ...base, runId: 'r3' }, // pre-durationMs ledger line
    ]);
    expect(s.totalDurationMs).toBe(4000);
    expect(s.avgDurationMs).toBe(2000);
  });
  it('zero runs → zero durations (no NaN)', () => {
    const s = summarizeLedger([]);
    expect(s.totalDurationMs).toBe(0);
    expect(s.avgDurationMs).toBe(0);
  });
});
