import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { loadConfig } from '../config.js';
import { runPath } from '../loop/run-path.js';

// probevane migrate <dir> --task "<migration>" | --to <pkg@version>
//                   [--only <path>] [--model …] [--quality] [--mfe] [--force-stop-after N]
//
// Codemod / framework-version migration: change source to the new API/version while
// every existing test stays green (behavior_lock). Run `probevane repair` after if
// a migration legitimately changes test expectations.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const task = flag(args, '--task');
  const to = flag(args, '--to');
  if (!task && !to) {
    console.error('usage: probevane migrate <dir> --task "<migration>" | --to <pkg@version>');
    process.exit(2);
  }
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  const maxSteps = parseInt(flag(args, '--max-steps') ?? String(cfg.maxSteps ?? 30), 10);
  const budgetRaw = flag(args, '--budget');
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : cfg.budget;

  const adapter = await selectAdapterOrThrow(dir);
  console.error(`[probevane] migrate adapter=${adapter.id} dir=${dir}`);

  const what = task ?? `migrate to ${to}`;
  const fullTask = [
    `Migration task: ${what}.`,
    ``,
    `Update SOURCE to the new API/version. Every existing test must still pass — do not weaken or`,
    `delete tests to make them pass (that is the behavior contract). Read the affected source first,`,
    `record a plan, apply the migration consistently, then ensure typecheck + the full suite stay green.`,
  ].join('\n');

  const quality = args.includes('--quality') || cfg.quality === true;
  const mfe = args.includes('--mfe') || cfg.mfe === true;
  const fsaRaw = flag(args, '--force-stop-after');
  const forceStopAfter = fsaRaw ? parseInt(fsaRaw, 10) : undefined;
  const only = flag(args, '--only');
  const outcome = await runPath({ dir, adapter, profileName: 'migrate', task: fullTask, model, maxSteps, budget, quality, mfe, forceStopAfter, only, worktree: args.includes("--worktree"), worktreeMerge: args.includes("--worktree-merge"), worktreeReview: args.includes("--worktree-review"), log: (l) => console.error(l) });
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
