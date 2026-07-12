import { join, relative } from 'node:path';
import { watch } from 'node:fs';
import { access } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { loadConfig } from '../util/config.js';
import { isSourceFile, specCandidatesFor } from '../util/git.js';
import { flag, dirArg } from './args.js';

// probevane watch <dir> [--run] [--debounce 800]
//
// Watch src/, and on each save map the changed file → the right action: it has
// a test → `repair`, else → `generate`. Dry-run by default (prints the plan);
// `--run` actually triggers the gated loop (needs credits).
async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const cfg = await loadConfig(dir);
  const run = args.includes('--run');
  const debounce = parseInt(flag(args, '--debounce') ?? '800', 10);
  const adapter = await selectAdapterOrThrow(dir);
  const srcDir = join(dir, 'src');

  console.error(`[watch] ${adapter.id} on ${srcDir} (${run ? 'RUN' : 'dry-run'}) — Ctrl-C to stop`);
  const pending = new Map<string, NodeJS.Timeout>();

  watch(srcDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = relative(dir, join(srcDir, filename.toString()));
    if (!isSourceFile(rel)) return;
    clearTimeout(pending.get(rel));
    pending.set(rel, setTimeout(() => void onChange(rel), debounce));
  });

  async function onChange(rel: string) {
    pending.delete(rel);
    let hasTest = false;
    for (const c of specCandidatesFor(rel)) if (await exists(join(dir, c))) hasTest = true;
    const action = hasTest ? 'repair' : 'generate';
    console.log(`[watch] ${rel} changed → ${action}`);
    if (!run) return;
    const { runPath } = await import('../loop/run/path.js');
    const { generateTests } = await import('../loop/run/generation.js');
    if (action === 'repair') {
      await runPath({
        dir, adapter, profileName: 'repair',
        task: `The source file ${rel} changed; update its affected tests so the suite is green.`,
        model: cfg.model ?? 'auto', budget: cfg.budget, log: (l) => console.error(l),
      }).catch((e) => console.error(String(e)));
    } else {
      await generateTests({
        dir, kind: 'unit', adapter, model: cfg.model ?? 'auto',
        only: rel, maxTargets: 1, budget: cfg.budget, log: (l) => console.error(l),
      }).catch((e) => console.error(String(e)));
    }
  }
}

const exists = (p: string) => access(p).then(() => true).catch(() => false);

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
