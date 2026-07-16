import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { buildSearchIndex, rankBySimilarity, similarPairs, type Indexed } from './search/index.js';
import { buildFnIndex } from './search/fn-similar.js';
import { embedText, embedModel } from './search/embed.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane search` backend — semantic code search over module embeddings:
// rank modules against a concept query, or list semantically-duplicate module
// PAIRS with --similar (--fns = function-pair merge candidates by doc-comment
// similarity). Named search-cmd (module collides with the ./search/ dir,
// precedent plan-cmd); logic moved verbatim from the old src/cli/search.ts
// shell. The spec declares NO dir: the first positional is the dir only when
// it EXISTS as a directory, otherwise it's part of the concept query (all
// remaining positionals join) — inexpressible in spec types, so the handler
// keeps its own positional walk over ctx.argv (the sanctioned raw escape
// hatch). --top/--threshold defaults also differ per mode (8 vs 20, 0.85 vs
// 0.9), so the spec declares them default-less and each mode applies its own.

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
function resolveDirAndQuery(ctx: CommandCtx): { dir: string; query: string } {
  const pos = positionals(ctx.argv);
  let dir = '.';
  let parts = pos;
  if (pos.length && existsSync(pos[0]) && statSync(pos[0]).isDirectory()) {
    dir = pos[0];
    parts = pos.slice(1);
  }
  return { dir: resolve(dir), query: (ctx.flags.query as string | undefined) ?? parts.join(' ') };
}

/** Doc line shown per pair member: the first sentence-ish chunk of the embedded doc. */
function docSnippet(index: Indexed[], path: string): string {
  const text = index.find((i) => i.path === path)?.text ?? '';
  return text.split('\n')[1]?.slice(0, 90) ?? '';
}

/** --similar --fns: function-pair merge candidates ranked by doc-comment similarity. */
async function similarFns(dir: string, ctx: CommandCtx): Promise<void> {
  const index = await buildFnIndex(dir, { fresh: ctx.flags.fresh === true });
  console.error(`[probevane] search: ${index.length} documented functions indexed via ${embedModel()}`);
  const th = (ctx.flags.threshold as number | undefined) ?? 0.9;
  const pairs = similarPairs(index, th, (ctx.flags.top as number | undefined) ?? 20);
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

/** Build/reuse the embedding index, then rank modules against the concept —
 *  or list near-duplicate module pairs with --similar (--fns = function level). */
export async function run(ctx: CommandCtx): Promise<void> {
  const { dir, query } = resolveDirAndQuery(ctx);

  if (ctx.flags.similar === true && ctx.flags.fns === true) return similarFns(dir, ctx);

  // Adapter is optional — search falls back to a source digest, so it works on any
  // dir / monorepo package even when no stack adapter matches.
  const adapter = await selectAdapterOrThrow(dir).catch(() => null);
  const index = await buildSearchIndex(dir, adapter, { fresh: ctx.flags.fresh === true });
  console.error(`[probevane] search: ${index.length} modules indexed via ${embedModel()}`);

  if (ctx.flags.similar === true) {
    const th = (ctx.flags.threshold as number | undefined) ?? 0.85;
    const pairs = similarPairs(index, th, (ctx.flags.top as number | undefined) ?? 20);
    if (!pairs.length) console.log(`[probevane] no module pairs >= ${th} similar (consolidation candidates) — lower --threshold to widen`);
    for (const p of pairs) console.log(`${p.score.toFixed(3)}  ${p.a}  ~  ${p.b}`);
    return;
  }

  if (!query) {
    console.error('usage: probevane search <dir> "<concept>"   |   probevane search <dir> --similar [--threshold 0.85]');
    process.exit(2);
  }
  const hits = rankBySimilarity(index, await embedText(query), (ctx.flags.top as number | undefined) ?? 8);
  console.log(`[probevane] search "${query}":`);
  for (const h of hits) console.log(`  ${h.score.toFixed(3)}  ${h.path}`);
}
