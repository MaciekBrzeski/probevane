import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { Rune } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { saveExample, readIndex, type ExampleMeta } from '../../library/store.js';
import { recordAudit } from '../../observe/audit.js';

// library_promote — closes the RAG flywheel. On an ACCEPTED run, promote each
// accepted spec into the cross-project learning library (index.jsonl) so
// retrieveFewShot (context_inject + onConsult fallback) starts hitting on future
// runs. Deduped by spec content hash. Opt-in via PROBEVANE_TRACES=1 (the same
// "learn from my wins" switch as distill_trace), so it never surprise-writes to
// the shared library. No-op otherwise → free to leave in every profile.

const TEST_RE = /(\.(test|spec)\.[tj]sx?$)|(test_\w+\.py$)|(_test\.py$)|(_test\.go$)|(tests\/.*\.rs$)/;

/** Infer e2e vs unit from the spec path (playwright *.spec.* / e2e dirs → e2e). */
export function kindFor(path: string): 'unit' | 'e2e' {
  return /\.spec\.[tj]sx?$/.test(path) || /(^|\/)e2e(\/|$)/.test(path) ? 'e2e' : 'unit';
}

/** Coarse category from the path, mirroring the library's category buckets. */
export function categoryFor(path: string): string {
  const b = basename(path);
  if (/use[A-Z]|hook/.test(b)) return 'hooks';
  if (kindFor(path) === 'e2e') return 'flow';
  if (/util|helper|lib|format|parse/.test(b)) return 'pure-helpers';
  return 'component';
}

/** Cleaner runs (fewer gate blocks) score higher; used by retrieveFewShot ranking. */
export function scoreFor(gateBlocks: number): number {
  return Math.max(0, Math.min(100, 100 - gateBlocks * 10));
}

/** Content-addressed slug: basename + short spec hash → dedup is slug presence. */
export function slugFor(path: string, spec: string): string {
  const stem = basename(path).replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const hash = createHash('sha1').update(spec).digest('hex').slice(0, 8);
  return `${stem}-${hash}`;
}

export const libraryPromote: Rune = {
  name: 'library_promote',

  async onStop(ctx: RunCtx): Promise<void> {
    if (!ctx.accepted || process.env.PROBEVANE_TRACES !== '1') return;
    const existing = await readIndex().catch(() => []);
    const seen = new Set(existing.map((r) => basename(r.path).replace(/\.md$/, '')));
    for (const rel of ctx.editedFiles) {
      if (!TEST_RE.test(rel)) continue;
      const spec = await readFile(join(ctx.workdir, rel), 'utf8').catch(() => '');
      if (!spec.trim()) continue;
      const slug = slugFor(rel, spec);
      if (seen.has(slug)) continue; // identical spec already promoted
      seen.add(slug);
      const meta: ExampleMeta = {
        slug,
        stack: ctx.adapter.id,
        kind: kindFor(rel),
        category: categoryFor(rel),
        quality: 'good',
        sourceFile: rel,
        score: scoreFor(ctx.gateBlocks),
        savedAt: new Date().toISOString(),
      };
      await saveExample(meta, spec).catch(() => {});
      const { stack, kind, category, quality, score } = meta;
      await recordAudit({
        action: 'library.save',
        target: meta.slug,
        detail: { stack, kind, category, quality, score },
      }).catch(() => {});
    }
  },
};
