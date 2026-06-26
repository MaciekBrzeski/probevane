import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { loadConfig } from '../config.js';
import { runPath } from '../loop/run-path.js';

// probevane fix <dir> --task "<issues to fix>" [--model …] [--budget N]
//
// Apply review findings (or any described fixes) to the code, keeping the whole
// test suite green and audit-clean (`fix` profile). Used standalone or by
// `probevane ci --review-fix`.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const task = flag(args, '--task');
  if (!task) {
    console.error('usage: probevane fix <dir> --task "<issues to fix>"');
    process.exit(2);
  }
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  const maxSteps = parseInt(flag(args, '--max-steps') ?? String(cfg.maxSteps ?? 30), 10);
  const budgetRaw = flag(args, '--budget');
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : cfg.budget;

  const adapter = await selectAdapterOrThrow(dir);
  const fullTask = [
    `Fix the following issues. Edit source (or a test only if the test itself is wrong).`,
    `Keep the WHOLE test suite green and audit-clean; do not suppress or weaken tests to hide a problem.`,
    `Read the relevant files and record a plan first.`,
    ``,
    task,
  ].join('\n');

  const quality = args.includes('--quality') || cfg.quality === true;
  const fsaRaw = flag(args, '--force-stop-after'); const forceStopAfter = fsaRaw ? parseInt(fsaRaw, 10) : undefined;
  const outcome = await runPath({ dir, adapter, profileName: 'fix', task: fullTask, model, maxSteps, budget, quality, forceStopAfter, log: (l) => console.error(l) });
  console.log(
    `[probevane] ${outcome.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} (${outcome.stopReason}) steps=${outcome.steps} ` +
      `tokens=${outcome.tokensIn}/${outcome.tokensOut}${outcome.tookOver ? ' (took over)' : ''}`,
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
