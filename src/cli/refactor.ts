import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { loadConfig } from '../config.js';
import { runPath } from '../loop/run-path.js';

// probevane refactor <dir> --task "extract / rename / simplify …" [--model …] [--max-steps N]
//
// Characterization-first: the existing test suite is the behavior contract
// (behavior_lock rune). The model changes ONLY source; every passing test must
// stay green. Run `probevane generate` first if the target has no tests.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const task = flag(args, '--task');
  if (!task) {
    console.error('usage: probevane refactor <dir> --task "<what to refactor>"');
    process.exit(2);
  }
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  const maxSteps = parseInt(flag(args, '--max-steps') ?? String(cfg.maxSteps ?? 30), 10);
  const budgetRaw = flag(args, "--budget"); const budget = budgetRaw ? parseInt(budgetRaw, 10) : cfg.budget;

  const adapter = await selectAdapterOrThrow(dir);
  console.error(`[probevane] refactor adapter=${adapter.id} dir=${dir}`);

  const fullTask = [
    `Refactor task: ${task}`,
    ``,
    `Change ONLY source files. Do not edit, add, or delete any test file — the tests are the`,
    `behavior contract and must all stay green. Read the relevant source first, record a plan,`,
    `make the refactor, then ensure typecheck passes and every test that passed before still passes.`,
  ].join('\n');

  const outcome = await runPath({ dir, adapter, profileName: "refactor", task: fullTask, model, maxSteps, budget, log: (l) => console.error(l) });
  console.log(
    `[probevane] ${outcome.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} (${outcome.stopReason}) steps=${outcome.steps} ` +
      `tokens=${outcome.tokensIn}/${outcome.tokensOut} cacheRead=${outcome.cacheRead}${outcome.tookOver ? ' (took over)' : ''}`,
  );
  if (!outcome.accepted) process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
