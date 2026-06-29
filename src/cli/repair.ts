import { resolve, join } from 'node:path';
import { access } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { loadConfig } from '../config.js';
import { runPath } from '../loop/run-path.js';
import { changedFiles, isSourceFile, specCandidatesFor } from '../git.js';

// probevane repair <dir> [--since <ref>] [--model …]
//
// After source changes, update the affected tests so the suite is green again.
// Uses git to find changed source → their sibling specs; the model updates those
// specs to match the new behavior (whole suite must end green).
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const since = flag(args, '--since') ?? 'HEAD';
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  const maxSteps = parseInt(flag(args, '--max-steps') ?? String(cfg.maxSteps ?? 30), 10);
  const budgetRaw = flag(args, "--budget"); const budget = budgetRaw ? parseInt(budgetRaw, 10) : cfg.budget;

  const adapter = await selectAdapterOrThrow(dir);
  const changed = (await changedFiles(dir, since)).filter(isSourceFile);
  if (changed.length === 0) {
    console.log('[probevane] no changed source files — nothing to repair');
    return;
  }

  // Map changed source → existing sibling specs.
  const pairs: { source: string; specs: string[] }[] = [];
  for (const source of changed) {
    const specs: string[] = [];
    for (const cand of specCandidatesFor(source))
      if (await access(join(dir, cand)).then(() => true).catch(() => false)) specs.push(cand);
    pairs.push({ source, specs });
  }
  const withSpecs = pairs.filter((p) => p.specs.length);
  console.error(`[probevane] repair adapter=${adapter.id}; ${changed.length} changed source file(s), ${withSpecs.length} with tests`);

  const fullTask = [
    `These source files changed; their tests may now be stale. Update ONLY the affected test files`,
    `so the whole suite passes again, matching the NEW behavior. Read the changed source first.`,
    `Do not change source. Do not weaken assertions to force a pass — reflect the real new behavior.`,
    ``,
    `Changed source → tests to repair:`,
    ...pairs.map((p) => `- ${p.source}${p.specs.length ? ` → ${p.specs.join(', ')}` : ' (no test found — add one if the behavior is now untested)'}`),
  ].join('\n');

  const quality = args.includes('--quality') || cfg.quality === true;
  const fsaRaw = flag(args, '--force-stop-after'); const forceStopAfter = fsaRaw ? parseInt(fsaRaw, 10) : undefined;
  const only = flag(args, '--only');
  const mfe = args.includes('--mfe') || cfg.mfe === true;
  const outcome = await runPath({ dir, adapter, profileName: "repair", task: fullTask, model, maxSteps, budget, quality, mfe, forceStopAfter, only, worktree: args.includes("--worktree"), worktreeMerge: args.includes("--worktree-merge"), log: (l) => console.error(l) });
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
