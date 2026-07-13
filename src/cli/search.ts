import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { buildSearchIndex, rankBySimilarity, similarPairs, type Indexed } from '../commands/search/index.js';
import { buildFnIndex } from '../commands/search/fn-similar.js';
import { embedText, embedModel } from '../commands/search/embed.js';
import { flag } from '../util/args.js';

// probevane search <dir> "<concept>"       — modules most similar to a concept
// probevane search <dir> --similar         — semantically-duplicate module PAIRS
//   (consolidation candidates the textual duplication detector can't see)
// probevane search <dir> --similar --fns   — FUNCTION pairs whose doc comments say
//   the same thing (merge candidates; leans on the doc-comment quality rule for
//   coverage). Default threshold 0.9 — short doc texts sit higher on the cosine
//   scale than module digests.
// Embeds each module's path + probe digest (cached at .probevane/search-index.json;
// function docs at .probevane/search-fn-index.json).
// Embedding endpoint: local ollama by default; PROBEVANE_EMBED_URL/_MODEL/_API_KEY override.

const VALUE_FLAGS = new Set(['--top', '--threshold', '--query']);

/** Positional args with value-flag values skipped — a --top value is never mistaken for the query. */
function positionals(args: string[]): string[] {
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (VALUE_FLAGS.has(args[i])) i++; // skip its value
      continue;
    }
    pos.push(args[i]);
  }
  return pos;
}

/** First positional that is a directory = dir; the rest (or --query) join into the concept. */
function resolveDirAndQuery(args: string[]): { dir: string; query: string } {
  const pos = positionals(args);
  let dir = '.';
  let parts = pos;
  if (pos.length && existsSync(pos[0]) && statSync(pos[0]).isDirectory()) {
    dir = pos[0];
    parts = pos.slice(1);
  }
  return { dir: resolve(dir), query: flag(args, '--query') ?? parts.join(' ') };
}

/** Doc line shown per pair member: the first sentence-ish chunk of the embedded doc. */
function docSnippet(index: Indexed[], path: string): string {
  const text = index.find((i) => i.path === path)?.text ?? '';
  return text.split('\n')[1]?.slice(0, 90) ?? '';
}

/** --similar --fns: function-pair merge candidates ranked by doc-comment similarity. */
async function similarFns(dir: string, args: string[]): Promise<void> {
  const index = await buildFnIndex(dir, { fresh: args.includes('--fresh') });
  console.error(`[probevane] search: ${index.length} documented functions indexed via ${embedModel()}`);
  const th = parseFloat(flag(args, '--threshold') ?? '0.9');
  const pairs = similarPairs(index, th, parseInt(flag(args, '--top') ?? '20', 10));
  if (!pairs.length) {
    console.log(`[probevane] no function pairs >= ${th} doc-similar — lower --threshold to widen`);
    return;
  }
  console.log(`[probevane] function merge candidates (doc-comment similarity; report-only — bodies may differ deliberately):`);
  for (const p of pairs) {
    console.log(`${p.score.toFixed(3)}  ${p.a}  ~  ${p.b}`);
    console.log(`        "${docSnippet(index, p.a)}"`);
    console.log(`        "${docSnippet(index, p.b)}"`);
  }
}

// Entry: build/reuse the embedding index, then rank modules against the concept —
// or list near-duplicate module pairs with --similar (--fns = function level).
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { dir, query } = resolveDirAndQuery(args);

  if (args.includes('--similar') && args.includes('--fns')) return similarFns(dir, args);

  // Adapter is optional — search falls back to a source digest, so it works on any
  // dir / monorepo package even when no stack adapter matches.
  const adapter = await selectAdapterOrThrow(dir).catch(() => null);
  const index = await buildSearchIndex(dir, adapter, { fresh: args.includes('--fresh') });
  console.error(`[probevane] search: ${index.length} modules indexed via ${embedModel()}`);

  if (args.includes('--similar')) {
    const th = parseFloat(flag(args, '--threshold') ?? '0.85');
    const pairs = similarPairs(index, th, parseInt(flag(args, '--top') ?? '20', 10));
    if (!pairs.length) console.log(`[probevane] no module pairs >= ${th} similar (consolidation candidates) — lower --threshold to widen`);
    for (const p of pairs) console.log(`${p.score.toFixed(3)}  ${p.a}  ~  ${p.b}`);
    return;
  }

  if (!query) {
    console.error('usage: probevane search <dir> "<concept>"   |   probevane search <dir> --similar [--threshold 0.85]');
    process.exit(2);
  }
  const hits = rankBySimilarity(index, await embedText(query), parseInt(flag(args, '--top') ?? '8', 10));
  console.log(`[probevane] search "${query}":`);
  for (const h of hits) console.log(`  ${h.score.toFixed(3)}  ${h.path}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
