import { selectAdapterOrThrow } from '../adapters/registry.js';
import { runMutation, type MutationRun } from '../loop/mutation.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane mutation` backend — full per-site mutation test: flips operators
// (===/!==/>=/<=/&&/true/+) one at a time, reruns the suite, reports killed vs
// SURVIVED (mutants the tests miss — the real signal that coverage isn't
// catching bugs). --min-score P exits 1 if below (CI gate). --budget caps
// mutants (sampled evenly). Logic moved verbatim from the old
// src/cli/mutation.ts shell; the vane interpreter owns argv. --only stays a
// raw string split in-handler (no filter) — verbatim old semantics.

/** Human report: score line, surviving-mutant sites, weakest files. */
function report(r: MutationRun): void {
  console.log(
    `\n[probevane] mutation score: ${Math.round(r.score * 100)}% ` +
      `(${r.killed}/${r.total} killed, ${r.survived} survived)${r.sampled ? ` [sampled ${r.total} of the full site set]` : ''}`,
  );
  if (r.survivors.length) {
    console.log(`\nSurviving mutants — tests do NOT catch these; strengthen the assertions:`);
    for (const m of r.survivors.slice(0, 40)) console.log(`  ${m.file}:${m.line}  ${m.op} → ${m.repl}    ${m.snippet}`);
    if (r.survivors.length > 40) console.log(`  … +${r.survivors.length - 40} more`);
  }
  const weak = Object.entries(r.byFile)
    .filter(([, v]) => v.killed < v.total)
    .sort((a, b) => a[1].killed / a[1].total - b[1].killed / b[1].total)
    .slice(0, 10);
  if (weak.length) {
    console.log(`\nWeakest files (mutation score):`);
    for (const [f, v] of weak) console.log(`  ${String(Math.round((v.killed / v.total) * 100)).padStart(3)}%  ${v.killed}/${v.total}  ${f}`);
  }
}

/** Run the budgeted/sampled mutation pass over ctx.dir, report (or --json),
 *  exit 1 when the score falls below --min-score. */
export async function run(ctx: CommandCtx): Promise<void> {
  const adapter = await selectAdapterOrThrow(ctx.dir);
  const only = ctx.flags.only as string | undefined;
  const r = await runMutation(ctx.dir, adapter, {
    budget: ctx.flags.budget as number | undefined,
    files: only ? only.split(',').map((s) => s.trim()) : undefined,
    all: ctx.flags.all === true,
    log: (l) => console.error(l),
  });

  if (ctx.flags.json === true) console.log(JSON.stringify(r, null, 2));
  else report(r);

  const min = ctx.flags['min-score'] as number | undefined;
  if (min !== undefined && r.score < min) {
    console.error(`[probevane] mutation: score ${(r.score * 100).toFixed(0)}% < min ${(min * 100).toFixed(0)}%`);
    process.exit(1);
  }
}
