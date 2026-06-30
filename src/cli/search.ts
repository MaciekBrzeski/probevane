import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { buildSearchIndex, rankBySimilarity, similarPairs } from '../search/index.js';
import { embedText, embedModel } from '../search/embed.js';

// probevane search <dir> "<concept>"     — modules most similar to a concept
// probevane search <dir> --similar       — semantically-duplicate module PAIRS
//   (consolidation candidates the textual duplication detector can't see)
// Embeds each module's path + probe digest (cached at .probevane/search-index.json).
// Embedding endpoint: local ollama by default; PROBEVANE_EMBED_URL/_MODEL/_API_KEY override.

const VALUE_FLAGS = new Set(['--top', '--threshold', '--query']);

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { dir, query } = resolveDirAndQuery(args);
  const adapter = await selectAdapterOrThrow(dir);
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
