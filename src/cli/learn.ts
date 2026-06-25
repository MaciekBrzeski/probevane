import { resolve, join, basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { auditFiles } from '../audit/core.js';
import { saveExample, LIB_ROOT } from '../library/store.js';

// probevane learn <dir> --file <spec> --category <c> [--kind unit|e2e] [--bad]
//
// Curate the cross-project learning library. Saves a spec as a worked example
// (good by default) with an audit-derived score, so future runs can few-shot it.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const file = flag(args, '--file');
  const category = flag(args, '--category') ?? 'misc';
  const kind = (flag(args, '--kind') ?? 'unit') as 'unit' | 'e2e';
  const quality = args.includes('--bad') ? 'bad' : 'good';
  const rationale = flag(args, '--rationale');

  if (!file) {
    console.error('usage: probevane learn <dir> --file <spec> --category <c> [--kind unit|e2e] [--bad]');
    process.exit(2);
  }

  const adapter = await selectAdapterOrThrow(dir);
  const abs = resolve(dir, file);
  const body = await readFile(abs, 'utf8');
  const report = await auditFiles([abs], adapter.auditRules());

  const slug = basename(file).replace(/\.[tj]sx?$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const rel = await saveExample(
    {
      slug,
      stack: adapter.id,
      kind,
      category,
      quality,
      sourceFile: file,
      rationale,
      score: report.score,
      savedAt: new Date().toISOString(),
    },
    body,
  );

  console.log(`[probevane] saved ${quality} example → ${join(LIB_ROOT, rel)} (score ${report.score}/5)`);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
