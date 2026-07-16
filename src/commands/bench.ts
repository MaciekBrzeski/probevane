import { selectAdapterOrThrow } from '../adapters/registry.js';
import { scoreSuite } from '../loop/passk.js';
import { mutationScore } from '../loop/mutation.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane bench` backend — measure a suite's real quality: green, tests,
// coverage, audit, and MUTATION SCORE (does it actually catch bugs?). Run on
// the golden suite, then re-run after `generate` to compare generated-vs-human
// side by side. Logic moved verbatim from the old src/cli/bench.ts shell; the
// vane interpreter owns argv.

/** Score + mutation-test the suite in ctx.dir and print the report table. */
export async function run(ctx: CommandCtx): Promise<void> {
  const dir = ctx.dir;
  const mutants = ctx.flags.mutants as number;
  const adapter = await selectAdapterOrThrow(dir);

  const s = await scoreSuite(dir, adapter);
  const m = await mutationScore(dir, adapter, mutants);

  console.log(
    [
      `### probevane bench — ${adapter.id}`,
      '',
      `| metric | value |`,
      `|---|---|`,
      `| suite | ${s.green ? 'green' : 'red'} (${s.tests} tests) |`,
      `| coverage | ${s.coverage}% |`,
      `| audit | ${s.auditScore}/5 (${s.auditErrors} errors) |`,
      `| mutation score | ${Math.round(m.score * 100)}% (${m.killed}/${m.total} mutants killed) |`,
      `| composite value | ${s.value} |`,
      '',
    ].join('\n'),
  );
}
