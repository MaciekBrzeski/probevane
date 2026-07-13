import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { scoreAssertions, aggregateScore, type AssertionScore } from '../audit/assertion-score.js';
import type { CommandCtx } from '../vane/run-command.js';

// `probevane assert-score` backend — grade how much the suite actually ASSERTS
// (weak: toBeDefined/toBeTruthy, tautology, snapshot-only, bare not.toThrow).
// Moved verbatim, INCLUDING its divergences: dir is used as given (never
// resolved absolute — spec paths join against it) and errors keep the
// `[assert-score] error:` prefix instead of the standard String(e).

/** Score assertions across ctx.dir's specs; --json for machine output. */
export async function run(ctx: CommandCtx): Promise<void> {
  try {
    const dir = ctx.argv.find((a) => !a.startsWith('--')) ?? '.';
    const adapter = await selectAdapterOrThrow(dir);
    const specs = await adapter.specFiles(dir);
    const perFile: Array<{ file: string; s: AssertionScore }> = [];
    for (const f of specs) {
      const src = await readFile(join(dir, f), 'utf8').catch(() => '');
      if (src) perFile.push({ file: f, s: scoreAssertions(src) });
    }
    const agg = aggregateScore(perFile);
    if (ctx.flags.json === true) {
      console.log(JSON.stringify({ ...agg, files: perFile }, null, 2));
      return;
    }
    console.log(`[assert-score] ${agg.score}/100 — ${agg.total} assertions, ${agg.weak} weak, across ${perFile.length} spec(s)`);
    for (const { file, s } of perFile) {
      if (!s.weak.length) continue;
      console.log(`\n  ${file}  (${s.score}/100)`);
      for (const w of s.weak.slice(0, 10)) console.log(`    - L${w.line} [${w.kind}] ${w.snippet}`);
    }
    if (agg.weak === 0) console.log('  ✓ no weak assertions');
  } catch (e) {
    console.error('[assert-score] error:', (e as Error).message);
    process.exit(1);
  }
}
