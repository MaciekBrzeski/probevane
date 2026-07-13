import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cosine, embedText } from '../src/commands/search/embed.js';
import { buildSearchIndex, rankBySimilarity, similarPairs, type Indexed } from '../src/commands/search/index.js';
import type { StackAdapter } from '../src/adapters/adapter.js';

describe('search/embed cosine', () => {
  it('identical→1, orthogonal→0, zero→0', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('search/embed embedText (endpoint formats)', () => {
  const fakeFetch = (body: object): typeof fetch =>
    (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

  it('parses an ollama-native {embedding} response', async () => {
    const v = await embedText('hi', fakeFetch({ embedding: [0.1, 0.2] }));
    expect(v).toEqual([0.1, 0.2]);
  });

  it('throws a helpful error on a non-OK response', async () => {
    const bad = (async () => ({ ok: false, status: 500, text: async () => 'down' })) as unknown as typeof fetch;
    await expect(embedText('hi', bad)).rejects.toThrow(/embed 500/);
  });
});

describe('search/index ranking', () => {
  const idx: Indexed[] = [
    { path: 'a.ts', text: 'a', vec: [1, 0, 0] },
    { path: 'b.ts', text: 'b', vec: [0.9, 0.1, 0] },
    { path: 'c.ts', text: 'c', vec: [0, 0, 1] },
  ];

  it('rankBySimilarity orders by cosine to the query', () => {
    const hits = rankBySimilarity(idx, [1, 0, 0], 2);
    expect(hits.map((h) => h.path)).toEqual(['a.ts', 'b.ts']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('similarPairs returns near-duplicate pairs above the threshold', () => {
    const pairs = similarPairs(idx, 0.85);
    expect(pairs).toHaveLength(1); // only a~b are >0.85 similar
    expect([pairs[0].a, pairs[0].b].sort()).toEqual(['a.ts', 'b.ts']);
    expect(similarPairs(idx, 0.999)).toEqual([]); // none that close
  });
});

describe('search/index buildSearchIndex', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const fakeAdapter = { probe: async () => ({ digest: 'exports: foo()' }) } as unknown as StackAdapter;
  let embedCalls = 0;
  const fakeEmbed = async (t: string): Promise<number[]> => {
    embedCalls++;
    return [t.length, t.includes('a.ts') ? 1 : 0];
  };

  it('embeds each module + caches; a second build with the same content skips re-embedding', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pv-search-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'src', 'b.ts'), 'import { a } from "./a.js";\nexport const b = a;\n');

    embedCalls = 0;
    const index = await buildSearchIndex(dir, fakeAdapter, { embed: fakeEmbed });
    expect(index.length).toBeGreaterThanOrEqual(2);
    expect(index.every((i) => Array.isArray(i.vec))).toBe(true);
    expect(embedCalls).toBe(index.length);
    expect(existsSync(join(dir, '.probevane', 'search-index.json'))).toBe(true);

    embedCalls = 0;
    const cached = await buildSearchIndex(dir, fakeAdapter, { embed: fakeEmbed });
    expect(embedCalls).toBe(0); // served from cache (same content hash)
    expect(cached.map((i) => i.path)).toEqual(index.map((i) => i.path));
  });
});

// ---------------------------------------------------------------------------
// function-level similarity — doc-comment embeddings (search --similar --fns)
// ---------------------------------------------------------------------------
import { buildFnIndex } from '../src/commands/search/fn-similar.js';
import { detectFunctionDocs } from '../src/quality/detect-docs.js';

describe('detectFunctionDocs', () => {
  it('extracts marker-stripped prose from block and line comments', () => {
    const src = [
      '/** Walks the tree.',
      ' *  Prunes vendored dirs. */',
      'export function walk(d: string) {',
      '  return d;',
      '}',
      '// Reads one file into memory — small files only.',
      'const readOne = (f: string) => {',
      '  return f;',
      '};',
    ].join('\n');
    expect(detectFunctionDocs(src)).toEqual([
      { name: 'walk', startLine: 3, doc: 'Walks the tree. Prunes vendored dirs.' },
      { name: 'readOne', startLine: 7, doc: 'Reads one file into memory — small files only.' },
    ]);
  });

  it('skips undocumented and nested functions', () => {
    const src = [
      'function bare() {',
      '  return 1;',
      '}',
      '/** Outer doc covers the closure. */',
      'function outer() {',
      '  const inner = () => {',
      '    return 2;',
      '  };',
      '  return inner();',
      '}',
    ].join('\n');
    const docs = detectFunctionDocs(src);
    expect(docs.map((d) => d.name)).toEqual(['outer']);
  });
});

describe('buildFnIndex', () => {
  function mkFnProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pv-fnsim-'));
    mkdirSync(join(dir, 'src', 'a'), { recursive: true });
    mkdirSync(join(dir, 'src', 'b'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a', 'x.ts'),
      '/** Recursively collect file paths under dir, pruning vendored dirs. */\nexport function walk(d: string) {\n  return d;\n}\n// tiny\nconst t = () => {\n  return 1;\n};\n');
    writeFileSync(join(dir, 'src', 'b', 'y.ts'),
      '/** Recursively collect file paths under dir, pruning vendored dirs. */\nexport function walkTree(d: string) {\n  return d;\n}\n');
    writeFileSync(join(dir, 'src', 'a', 'x.test.ts'),
      '/** Recursively collect file paths — test copy must be excluded. */\nexport function walkT(d: string) {\n  return d;\n}\n');
    return dir;
  }

  it('indexes documented fns (tests + short docs excluded), caches, and pairs identical docs at 1.0', async () => {
    const dir = mkFnProject();
    let calls = 0;
    // Deterministic embed: identical text → identical vec (hash the doc into 2 dims).
    const fakeEmbed = async (t: string) => {
      calls++;
      const doc = t.split('\n')[1] ?? '';
      return [doc.length, doc.includes('vendored') ? 1 : 0];
    };
    const index = await buildFnIndex(dir, { embed: fakeEmbed });
    // walk + walkTree only: the test file and the <20-char "tiny" doc are excluded
    expect(index.map((i) => i.path).sort()).toEqual([
      'src/a/x.ts:2 walk()',
      'src/b/y.ts:2 walkTree()',
    ]);
    expect(calls).toBe(2);

    const pairs = similarPairs(index, 0.9, 20);
    expect(pairs.length).toBe(1);
    expect(pairs[0].score).toBeCloseTo(1.0, 5);

    // cache hit: same content → zero embed calls
    calls = 0;
    await buildFnIndex(dir, { embed: fakeEmbed });
    expect(calls).toBe(0);
    expect(existsSync(join(dir, '.probevane', 'search-fn-index.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
