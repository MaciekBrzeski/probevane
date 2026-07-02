import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { scoreAssertions, aggregateScore, type AssertionScore } from '../audit/assertion-score.js';

// probevane assert-score <dir> [--json] — grade how much the suite actually
// ASSERTS (weak: toBeDefined/toBeTruthy, tautology, snapshot-only, bare
// not.toThrow). Complements `audit` (assertion-free) and `bench` (mutation).

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? '.';
  const adapter = await selectAdapterOrThrow(dir);
  const specs = await adapter.specFiles(dir);
  const perFile: Array<{ file: string; s: AssertionScore }> = [];
  for (const f of specs) {
    const src = await readFile(join(dir, f), 'utf8').catch(() => '');
    if (src) perFile.push({ file: f, s: scoreAssertions(src) });
  }
  const agg = aggregateScore(perFile);

  if (args.includes('--json')) {
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
}

main().catch((e) => { console.error('[assert-score] error:', e.message); process.exit(1); });
