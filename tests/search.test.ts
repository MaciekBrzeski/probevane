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
