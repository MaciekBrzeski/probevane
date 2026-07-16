import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { changedFiles, isSourceFile } from '../util/git.js';
import { buildGraph, resolveLocalImports } from '../mock/graph.js';
import { impactedSpecs } from '../loop/impact.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane impact` backend — test-impact analysis: which specs are affected
// by the changes since --base (transitive import graph); --run executes only
// those (via the adapter), otherwise prints the set. Logic moved verbatim
// from the old src/cli/impact.ts shell (own catch: `[impact] error:` prefix +
// e.message, unlike the standard String(e)); the vane interpreter owns argv.

/** Compute (and with --run, execute) the impacted spec set for ctx.dir. */
export async function run(ctx: CommandCtx): Promise<void> {
  try {
    const dir = ctx.dir;
    const base = ctx.flags.base as string;
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

    if (ctx.flags.json) {
      console.log(JSON.stringify({ base, changed, impacted, total: specs.length }, null, 2));
      return;
    }
    const pct = specs.length ? Math.round((impacted.length / specs.length) * 100) : 0;
    console.log(`[impact] ${changed.length} changed source file(s) since ${base} → ${impacted.length}/${specs.length} spec(s) impacted (${pct}% — skip the other ${specs.length - impacted.length})`);
    impacted.forEach((s) => console.log(`  ${s}`));

    if (ctx.flags.run) {
      if (!impacted.length) { console.log('[impact] nothing impacted — suite skip.'); return; }
      const res = await adapter.run(dir, 'all', impacted);
      console.log(`[impact] ran ${impacted.length} spec(s): ${res.green ? 'GREEN' : `RED (${res.failed} failing)`}`);
      if (!res.green) process.exit(1);
    }
  } catch (e) {
    console.error('[impact] error:', (e as Error).message);
    process.exit(1);
  }
}
