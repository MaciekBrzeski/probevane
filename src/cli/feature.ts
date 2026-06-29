import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { loadConfig } from '../config.js';
import { runPath } from '../loop/run-path.js';

// probevane feature <dir> --task "add discount to cartTotal …" [--model …] [--max-steps N]
//
// TDD red-first (red_first rune): the model writes a NEW test that fails against
// the current code, then implements the feature in source until it passes;
// pre-existing tests stay green (no_regression).
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const task = flag(args, '--task');
  if (!task) {
    console.error('usage: probevane feature <dir> --task "<feature to add>"');
    process.exit(2);
  }
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  const maxSteps = parseInt(flag(args, '--max-steps') ?? String(cfg.maxSteps ?? 32), 10);
  const budgetRaw = flag(args, "--budget"); const budget = budgetRaw ? parseInt(budgetRaw, 10) : cfg.budget;

  const adapter = await selectAdapterOrThrow(dir);
  console.error(`[probevane] feature adapter=${adapter.id} dir=${dir}`);

  const fullTask = [
    `Feature task: ${task}`,
    ``,
    `Work test-first (TDD): FIRST add a NEW test that specifies this feature and FAILS against the`,
    `current code. Then implement the feature in source until that test passes. Do not change or`,
    `weaken existing tests — they must stay green. Read the relevant files and record a plan first.`,
  ].join('\n');

  const quality = args.includes('--quality') || cfg.quality === true;
  const fsaRaw = flag(args, '--force-stop-after'); const forceStopAfter = fsaRaw ? parseInt(fsaRaw, 10) : undefined;
  const only = flag(args, '--only');
  const mfe = args.includes('--mfe') || cfg.mfe === true;
  const outcome = await runPath({ dir, adapter, profileName: "feature", task: fullTask, model, maxSteps, budget, quality, mfe, forceStopAfter, only, worktree: args.includes("--worktree"), worktreeMerge: args.includes("--worktree-merge"), worktreeReview: args.includes("--worktree-review"), log: (l) => console.error(l) });
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
