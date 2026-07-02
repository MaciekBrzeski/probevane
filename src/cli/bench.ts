import { selectAdapterOrThrow } from '../adapters/registry.js';
import { scoreSuite } from '../loop/passk.js';
import { mutationScore } from '../loop/mutation.js';
import { flag, dirArg } from './args.js';

// probevane bench <dir> [--mutants N]
//
// Measure a suite's real quality: green, tests, coverage, audit, and MUTATION
// SCORE (does it actually catch bugs?). Run on the golden suite, then re-run
// after `generate` to compare generated-vs-human side by side.
async function main() {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const mutants = parseInt(flag(args, '--mutants') ?? '6', 10);
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

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
