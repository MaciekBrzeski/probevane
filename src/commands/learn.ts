import { resolve, join, basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { auditFiles } from '../audit/core.js';
import { saveExample, LIB_ROOT } from '../library/store.js';
import { recordAudit } from '../observe/audit.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane learn` backend — curate the cross-project learning library: save
// a spec as a worked example (good by default, --bad for anti-patterns) with
// an audit-derived score, so future runs can few-shot it. Logic moved verbatim
// from the old src/cli/learn.ts shell; the vane interpreter owns argv.

/** Save --file (relative to ctx.dir) into the library under --category. */
export async function run(ctx: CommandCtx): Promise<void> {
  const file = ctx.flags.file as string | undefined;
  const category = (ctx.flags.category as string | undefined) ?? 'misc';
  const kind = ((ctx.flags.kind as string | undefined) ?? 'unit') as 'unit' | 'e2e';
  const quality = (ctx.flags.bad === true ? 'bad' : 'good') as 'good' | 'bad';
  const rationale = ctx.flags.rationale as string | undefined;

  if (!file) {
    console.error('usage: probevane learn <dir> --file <spec> --category <c> [--kind unit|e2e] [--bad]');
    process.exit(2);
  }

  const adapter = await selectAdapterOrThrow(ctx.dir);
  const abs = resolve(ctx.dir, file);
  const body = await readFile(abs, 'utf8');
  const report = await auditFiles([abs], adapter.auditRules());

  const slug = basename(file).replace(/\.[tj]sx?$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const meta = {
    slug,
    stack: adapter.id,
    kind,
    category,
    quality,
    sourceFile: file,
    rationale,
    score: report.score,
    savedAt: new Date().toISOString(),
  };
  const rel = await saveExample(meta, body);
  await recordAudit({
    action: 'library.save',
    target: meta.slug,
    detail: { stack: meta.stack, kind: meta.kind, category: meta.category, quality: meta.quality, score: meta.score },
  });

  console.log(`[probevane] saved ${quality} example → ${join(LIB_ROOT, rel)} (score ${report.score}/5)`);
}
