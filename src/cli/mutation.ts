import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { runMutation, type MutationRun } from '../loop/mutation.js';

// probevane mutation <dir> [--budget N] [--only a,b] [--min-score P] [--json]
//   Full per-site mutation test: flips operators (===/!==/>=/<=/&&/true/+) one at
//   a time, reruns the suite, reports killed vs SURVIVED (mutants the tests miss —
//   the real signal that coverage isn't catching bugs). --min-score P exits 1 if
//   below (CI gate). --budget caps mutants (sampled evenly); omit for the default 50.

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const adapter = await selectAdapterOrThrow(dir);
  const only = flag(args, '--only');
  const r = await runMutation(dir, adapter, {
    budget: parseInt(flag(args, '--budget') ?? '50', 10),
    files: only ? only.split(',').map((s) => s.trim()) : undefined,
    all: args.includes('--all'),
    log: (l) => console.error(l),
  });

  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else report(r);

  const min = flag(args, '--min-score');
  if (min && r.score < parseFloat(min)) {
    console.error(`[probevane] mutation: score ${(r.score * 100).toFixed(0)}% < min ${(parseFloat(min) * 100).toFixed(0)}%`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
