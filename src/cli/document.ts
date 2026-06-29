import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { loadConfig } from '../config.js';
import { runPath } from '../loop/run-path.js';

// probevane document <dir> [--only <path>] [--task "<focus>"] [--model …] [--force-stop-after N]
//
// Add documentation only — JSDoc/TSDoc on exported APIs, clarifying comments on
// non-obvious logic. No behavior change: tests + typecheck must stay green
// (behavior_lock). Use --only to focus one file/area.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const only = flag(args, '--only');
  const focus = flag(args, '--task');
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  const maxSteps = parseInt(flag(args, '--max-steps') ?? String(cfg.maxSteps ?? 30), 10);
  const budgetRaw = flag(args, '--budget');
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : cfg.budget;

  const adapter = await selectAdapterOrThrow(dir);
  console.error(`[probevane] document adapter=${adapter.id} dir=${dir}`);

  const fullTask = [
    `Documentation task${focus ? `: ${focus}` : ': add JSDoc/TSDoc to exported APIs and clarify non-obvious logic'}.`,
    ``,
    `Add ONLY documentation — JSDoc/TSDoc comments on exported functions/types/classes (params,`,
    `returns, throws) and short comments on non-obvious logic. Do NOT change behavior, signatures,`,
    `or logic. Tests and typecheck must stay green afterward.`,
  ].join('\n');

  const fsaRaw = flag(args, '--force-stop-after');
  const forceStopAfter = fsaRaw ? parseInt(fsaRaw, 10) : undefined;
  const outcome = await runPath({ dir, adapter, profileName: 'document', task: fullTask, model, maxSteps, budget, forceStopAfter, only, worktree: args.includes("--worktree"), worktreeMerge: args.includes("--worktree-merge"), log: (l) => console.error(l) });
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
