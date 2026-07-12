import { selectAdapterOrThrow } from '../adapters/registry.js';
import { flag, dirArg } from './args.js';
import { loadConfig, type ProbevaneConfig } from '../util/config.js';
import { runPath, type RunPathOpts } from '../loop/run/path.js';
import type { ProfileName } from '../loop/profiles.js';
import type { StackAdapter } from '../adapters/adapter.js';
import type { RunOutcome } from '../loop/engine/index.js';

// Shared scaffolding for the single-task path CLIs (feature / refactor / repair /
// fix / migrate / document). Each of those used to repeat the same flag parsing,
// runPath call, ACCEPTED/NOT-ACCEPTED print and exit handling; they now resolve
// only their own task-building and delegate the rest to runPathCli.

/** Per-CLI knobs for the bits that legitimately differ between path commands. */
export interface PathCliSpec {
  /** maxSteps fallback when neither --max-steps nor cfg.maxSteps is set (default 30). */
  maxStepsDefault?: number;
  /** Append ` cacheRead=N` to the result line (feature/refactor/repair do). */
  cacheRead?: boolean;
  /** Parse + pass --quality/--mfe (default true; document opts out entirely). */
  quality?: boolean;
  /** Inject extra runPath options from argv/config (e.g. the visual path's render gate). */
  extraOpts?: (args: string[], cfg: ProbevaneConfig) => Partial<RunPathOpts>;
}

/**
 * Build the profile-specific task string. Receives the parsed argv, the resolved
 * target dir, the loaded config and a lazy adapter resolver (so a CLI that wants
 * the adapter for its own logging can get it without forcing resolution before
 * its own usage-error exit). Return null to abort the run cleanly (exit 0) —
 * used by repair when there is nothing to do.
 */
export type BuildTask = (
  args: string[],
  dir: string,
  cfg: ProbevaneConfig,
  getAdapter: () => Promise<StackAdapter>,
) => string | null | Promise<string | null>;

/** Print the shared outcome line, including cacheRead only when requested. */
function printOutcome(outcome: RunOutcome, cacheRead: boolean): void {
  const cr = cacheRead ? ` cacheRead=${outcome.cacheRead}` : '';
  console.log(
    `[probevane] ${outcome.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} (${outcome.stopReason}) steps=${outcome.steps} ` +
      `tokens=${outcome.tokensIn}/${outcome.tokensOut}${cr}${outcome.tookOver ? ' (took over)' : ''}`,
  );
}

/**
 * Run a single-task path command: parse the shared flags, build the task via the
 * caller's `buildTask`, run the loop through runPath, print the result and exit
 * non-zero if it was not accepted. The adapter is resolved lazily and cached, so
 * a usage-error exit inside buildTask still precedes adapter resolution.
 */
export async function runPathCli(
  profileName: ProfileName,
  buildTask: BuildTask,
  spec: PathCliSpec = {},
): Promise<void> {
  const args = process.argv.slice(2);
  const dir = dirArg(args);
  const cfg = await loadConfig(dir);
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  const maxSteps = parseInt(flag(args, '--max-steps') ?? String(cfg.maxSteps ?? (spec.maxStepsDefault ?? 30)), 10);
  const budgetRaw = flag(args, '--budget');
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : cfg.budget;

  let adapter: StackAdapter | undefined;
  const getAdapter = async (): Promise<StackAdapter> => (adapter ??= await selectAdapterOrThrow(dir));

  const fullTask = await buildTask(args, dir, cfg, getAdapter);
  if (fullTask == null) return; // clean no-op (e.g. repair found nothing to do)
  const resolvedAdapter = await getAdapter();

  const fsaRaw = flag(args, '--force-stop-after');
  const forceStopAfter = fsaRaw ? parseInt(fsaRaw, 10) : undefined;
  const only = flag(args, '--only');
  const qualityOn = spec.quality !== false;
  const quality = qualityOn ? args.includes('--quality') || cfg.quality === true : undefined;
  const mfe = qualityOn ? args.includes('--mfe') || cfg.mfe === true : undefined;

  const outcome = await runPath({
    dir,
    adapter: resolvedAdapter,
    profileName,
    task: fullTask,
    model,
    maxSteps,
    budget,
    quality,
    mfe,
    forceStopAfter,
    only,
    worktree: args.includes('--worktree'),
    worktreeMerge: args.includes('--worktree-merge'),
    worktreeReview: args.includes('--worktree-review'),
    ...(spec.extraOpts?.(args, cfg) ?? {}),
    log: (l) => console.error(l),
  });
  printOutcome(outcome, spec.cacheRead === true);
  if (!outcome.accepted) process.exit(1);
}

/** Shared entry wrapper: run a path CLI and exit(1) on any unhandled error. */
export function runPathCliMain(
  profileName: ProfileName,
  buildTask: BuildTask,
  spec: PathCliSpec = {},
): void {
  runPathCli(profileName, buildTask, spec).catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
