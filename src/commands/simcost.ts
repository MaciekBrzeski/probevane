import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { isEasyTarget } from '../loop/triage.js';
import { formatReport, simulateCost, savings } from '../cost/simulate.js';
import { readRuns } from '../cost/ledger.js';
import { projectLedger, formatProjection } from '../cost/project.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane simcost` backend — simulated cost benchmark. With a dir: triage
// discovered modules → easy/hard counts → simulate; without: --easy/--hard
// manually. Compares all-api vs hybrid vs bridge, grounded in measured
// per-module costs from the ledger. --project reprices the metered token
// volume of all $0 (bridge/local) runs at haiku/sonnet/opus rates. Logic
// moved verbatim from the old src/cli/simcost.ts shell, including the
// deliberately UNRESOLVED optional dir (spec `arg`, '' = manual mode) and
// the `[simcost] error:` prefix (own catch, not the interpreter's).

/** Simulate (or --project reprice) and print; errors keep the [simcost] prefix. */
export async function run(ctx: CommandCtx): Promise<void> {
  try {
    if (ctx.flags.project === true) {
      const p = projectLedger(await readRuns());
      if (ctx.flags.json === true) console.log(JSON.stringify(p, null, 2));
      else console.log(formatProjection(p));
      return;
    }

    const dir = ctx.args.dir || undefined; // unresolved on purpose — verbatim old semantics
    const hit = (ctx.flags['local-hit'] as number | undefined) ?? 0.5;

    let easy = (ctx.flags.easy as number | undefined) ?? 0;
    let hard = (ctx.flags.hard as number | undefined) ?? 0;
    if (dir) {
      const adapter = await selectAdapterOrThrow(dir);
      const kind = ((ctx.flags.kind as string | undefined) ?? 'unit') as 'unit' | 'e2e';
      const targets = await adapter.discover(dir, kind);
      let e = 0, h = 0;
      for (const t of targets) {
        const src = await readFile(join(dir, t.sourcePath), 'utf8').catch(() => '');
        isEasyTarget(t, src).easy ? e++ : h++;
      }
      easy = e; hard = h;
      console.error(`[simcost] triaged ${dir}: ${easy} easy + ${hard} hard (of ${targets.length})`);
    }

    if (ctx.flags.json === true) {
      console.log(JSON.stringify(savings(simulateCost({ easy, hard }, hit)), null, 2));
      return;
    }
    console.log(formatReport({ easy, hard }, hit));
  } catch (e) {
    console.error('[simcost] error:', (e as Error).message);
    process.exit(1);
  }
}
