import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { changedFiles, isSourceFile } from '../git.js';
import { buildGraph, resolveLocalImports } from '../mock/graph.js';
import { impactedSpecs } from '../loop/impact.js';
import { flag, dirArg } from './args.js';

// probevane impact <dir> [--base <ref>] [--run] [--json]
//   Test-impact analysis: which specs are affected by the changes since <base>.
//   --run executes only those (via the adapter); otherwise prints the set.

async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const base = flag(args, '--base') ?? 'HEAD~1';
  const adapter = await selectAdapterOrThrow(dir);

  const changed = (await changedFiles(dir, base)).filter(isSourceFile);
  const graph = await buildGraph(dir);
  const sourceAbs = [...graph.nodes.keys()].map((rel) => join(dir, rel));
  const specs = await adapter.specFiles(dir);

  const specDeps = new Map<string, string[]>();
  for (const spec of specs) {
    const src = await readFile(join(dir, spec), 'utf8').catch(() => '');
    specDeps.set(spec, resolveLocalImports(src, join(dir, spec), dir, sourceAbs));
  }

  const impacted = impactedSpecs(graph, specDeps, changed);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ base, changed, impacted, total: specs.length }, null, 2));
    return;
  }
  const pct = specs.length ? Math.round((impacted.length / specs.length) * 100) : 0;
  console.log(`[impact] ${changed.length} changed source file(s) since ${base} → ${impacted.length}/${specs.length} spec(s) impacted (${pct}% — skip the other ${specs.length - impacted.length})`);
  impacted.forEach((s) => console.log(`  ${s}`));

  if (args.includes('--run')) {
    if (!impacted.length) { console.log('[impact] nothing impacted — suite skip.'); return; }
    const res = await adapter.run(dir, 'all', impacted);
    console.log(`[impact] ran ${impacted.length} spec(s): ${res.green ? 'GREEN' : `RED (${res.failed} failing)`}`);
    if (!res.green) process.exit(1);
  }
}

main().catch((e) => { console.error('[impact] error:', e.message); process.exit(1); });
