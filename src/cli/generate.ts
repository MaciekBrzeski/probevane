import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { isEasyTarget } from '../loop/triage.js';
import { draftLocal } from '../loop/draft-local.js';
import { brainFor } from '../brain/select.js';
import { runPool } from '../util/concurrent.js';
import { anthropicBrain } from '../brain/anthropic-sdk.js';
import { generateTests } from '../loop/run-generation.js';
import { loadConfig, pick } from '../config.js';
import type { TestKind } from '../adapters/adapter.js';

// probevane generate <dir> [--kind unit|e2e] [--model …] [--max-steps N] [--max-targets N] [--min-tests N] [--min-coverage P]
//
// Precedence for every option: CLI flag > probevane.config.{ts,json} > default.
async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const num = (s?: string) => (s !== undefined ? parseInt(s, 10) : undefined);

  const kind = (flag(args, '--kind') ?? cfg.kind ?? 'unit') as TestKind;
  const maxSteps = pick(num(flag(args, '--max-steps')), cfg.maxSteps, 30)!;
  const maxTargets = pick(num(flag(args, '--max-targets')), cfg.maxTargets, 8)!;
  const minTests = pick(num(flag(args, '--min-tests')), cfg.minTests, kind === 'e2e' ? 1 : 5)!;
  const minCoverage = pick(num(flag(args, '--min-coverage')), cfg.minCoverage);
  const mutation = args.includes('--mutation') || cfg.mutation === true;
  const mock = args.includes('--mock') || (!args.includes('--no-mock') && (cfg.mock ?? kind === 'unit'));
  const targetGaps = args.includes('--target-gaps');
  const flakeGuard = args.includes('--flake-guard') || cfg.flakeGuard === true;
  const a11y = args.includes('--a11y') || cfg.a11y === true;
  const visual = args.includes('--visual') || cfg.visual === true;
  const budget = pick(num(flag(args, '--budget')), cfg.budget);
  const passk = parseInt(flag(args, '--passk') ?? '1', 10);

  const adapter = await selectAdapterOrThrow(dir);
  // --model auto (default) detects complex code and routes it to a stronger
  // model up front; or pin haiku|sonnet|opus|<id>. Explicit --takeover overrides
  // the escalation tier.
  const model = flag(args, '--model') ?? cfg.model ?? 'auto';
  console.error(`[probevane] generate kind=${kind} adapter=${adapter.id} model=${model} dir=${dir}`);

  const takeoverOverride = flag(args, '--takeover');
  const genOpts = (d: string) => ({
    dir: d,
    kind,
    adapter,
    model,
    takeoverBrain: takeoverOverride && takeoverOverride !== 'none' ? anthropicBrain(takeoverOverride) : undefined,
    maxSteps,
    maxTargets,
    only: flag(args, '--only'),
    minTests,
    minCoverage,
    mutation,
    flakeGuard,
    a11y,
    visual,
    flakeTolerance: num(flag(args, '--flake-tolerance')),
    assertMin: num(flag(args, '--assert-min')),
    quality: args.includes('--quality') || cfg.quality === true,
    budget,
    mock,
    targetGaps,
    property: args.includes('--property'),
    mutationTarget: args.includes('--mutation-target'),
    log: (l: string) => console.error(l),
  });

  // Easy-band triage (dry run): classify discovered targets into local-draftable
  // (pure, low-fact, $0) vs bridge-needed (IO/component/fact-heavy). Routing hint
  // for a hybrid run — local clears the easy band free, bridge handles the rest.
  if (args.includes('--triage')) {
    let targets = await adapter.discover(dir, kind);
    const only = flag(args, '--only');
    if (only) targets = targets.filter((t) => t.sourcePath.includes(only));
    const rows = await Promise.all(targets.map(async (t) => {
      const src = await readFile(join(dir, t.sourcePath), 'utf8').catch(() => '');
      return { t, tri: isEasyTarget(t, src) };
    }));
    const easy = rows.filter((r) => r.tri.easy);
    const hard = rows.filter((r) => !r.tri.easy);
    console.log(`[triage] ${easy.length} local-draftable ($0), ${hard.length} bridge-needed, of ${rows.length} target(s)\n`);
    console.log('LOCAL ($0 easy band):');
    easy.forEach((r) => console.log(`  + ${r.t.sourcePath}`));
    console.log('\nBRIDGE (fact-heavy / IO / component):');
    hard.slice(0, 40).forEach((r) => console.log(`  - ${r.t.sourcePath}  [${r.tri.reasons.join(', ')}]`));
    return;
  }

  // Hybrid: local model drafts the easy/pure band ($0), bridge/paid handles the
  // rest. Triage → for each easy target run the focused local drafter (write +
  // verify with gates); then the normal loop covers what's left (now the hard,
  // fact-heavy modules). --local-model picks the local brain (default ollama
  // qwen2.5-coder:7b; point PROBEVANE_BASE_URL at a shim to use a trained adapter).
  if (args.includes('--hybrid')) {
    const localBrain = brainFor(flag(args, '--local-model') ?? 'local:qwen2.5-coder:7b');
    let targets = await adapter.discover(dir, kind);
    const only = flag(args, '--only');
    if (only) targets = targets.filter((t) => t.sourcePath.includes(only));
    const routed = await Promise.all(targets.map(async (t) => {
      const src = await readFile(join(dir, t.sourcePath), 'utf8').catch(() => '');
      return { t, easy: isEasyTarget(t, src).easy };
    }));
    const easy = routed.filter((r) => r.easy).map((r) => r.t);
    const conc = num(flag(args, '--concurrency')) ?? 3;
    console.error(`[hybrid] ${easy.length} easy → local (${localBrain.model}, ${conc}-way), rest → bridge (${model})`);
    const drafts = await runPool(
      easy,
      (t) => draftLocal({ dir, target: t, kind, adapter, brain: localBrain, log: (l) => console.error(l) }).catch(() => ({ accepted: false } as any)),
      conc,
    );
    const localOk = drafts.filter((r) => r.accepted).length;
    console.error(`[hybrid] local landed ${localOk}/${easy.length} easy targets ($0). Bridge handles the rest…`);
    const out = await generateTests(genOpts(dir));
    console.log(`[hybrid] DONE: local ${localOk}/${easy.length} easy ($0) + bridge ${out.accepted ? 'ACCEPTED' : out.stopReason} on the rest. Cost: probevane history`);
    return;
  }

  // Shape B: --delegate hands the WHOLE task to an external harness (claude -p),
  // then runs probevane's gates on the diff. `--model cc:<m>`/`claude-code` picks
  // the claude model; default sonnet.
  if (args.includes('--delegate')) {
    const { runDelegated } = await import('../loop/delegate.js');
    const ccModel = model.startsWith('cc:') ? model.slice(3) : model === 'claude-code' ? undefined : 'sonnet';
    const out = await runDelegated({ dir, kind, adapter, model: ccModel, only: flag(args, '--only'), maxRounds: num(flag(args, '--rounds')) ?? 3, log: (l) => console.error(l) });
    console.log(
      `[probevane] DELEGATE ${out.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} rounds=${out.rounds} ` +
        `specs=${out.changedFiles.length} green=${out.green} auditErr=${out.auditErrors} cost=$${out.costUsd.toFixed(4)}`,
    );
    if (!out.accepted) process.exit(1);
    return;
  }

  if (passk > 1) {
    // pass@k: sample K candidate suites, keep the best-scoring one.
    const { passKGenerate } = await import('../loop/passk.js');
    const { best } = await passKGenerate({
      dir, kind, adapter, k: passk,
      generate: async (cand) => (await generateTests(genOpts(cand))).accepted,
      log: (l) => console.error(l),
    });
    console.log(`[probevane] pass@${passk}: ${best ? `selected ${best.label} (value=${best.score.value}, tests=${best.score.tests}, cov=${best.score.coverage}%)` : 'no acceptable candidate'}`);
    if (!best) process.exit(1);
    return;
  }

  const outcome = await generateTests(genOpts(dir));

  console.log(
    `[probevane] ${outcome.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} (${outcome.stopReason}) ` +
      `steps=${outcome.steps} toolCalls=${outcome.toolCalls} gateBlocks=${outcome.gateBlocks} ` +
      `tokens=${outcome.tokensIn}/${outcome.tokensOut} cacheRead=${outcome.cacheRead}${outcome.tookOver ? ' (took over)' : ''}`,
  );

  // Machine-readable result (for `probevane factory` — lets the parent skip a
  // redundant suite re-run). Prefer the signals the gates already captured; only
  // measure what's missing, once.
  const reportPath = flag(args, '--report');
  if (reportPath) {
    const { writeFile } = await import('node:fs/promises');
    let tests = outcome.tests;
    let coverage = outcome.coverage;
    if (outcome.accepted) {
      if (tests === undefined) {
        const specs = await adapter.specFiles(dir).catch(() => [] as string[]);
        if (specs.length) tests = (await adapter.run(dir, kind, specs).catch(() => null))?.passed;
      }
      if (coverage === undefined) coverage = (await adapter.coverage(dir).catch(() => null))?.lines ?? undefined;
    }
    await writeFile(
      reportPath,
      JSON.stringify({ accepted: outcome.accepted, stopReason: outcome.stopReason, tests: tests ?? 0, coverage: coverage ?? null }, null, 2),
    );
  }

  // Autonomous delivery: on accept, branch + commit + open a PR for this run.
  if (args.includes('--ship') && outcome.accepted) {
    const { shipRun, latestDiary } = await import('../ship/ship.js');
    const diary = await latestDiary(dir);
    if (diary) {
      const r = await shipRun(dir, diary, { op: 'generate', repo: dir, tests: outcome.tests, coverage: outcome.coverage, cost: undefined }, (l) => console.error(l));
      console.log(`[probevane] ship: ${r.shipped ? r.prUrl ?? r.branch ?? 'delivered' : 'skipped — ' + r.reason}`);
    }
  }

  // Produce/refresh the project spec as part of the run (reflects the new tests' coverage).
  if (args.includes('--spec')) {
    const { buildSpec } = await import('../spec/build.js');
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const md = await buildSpec({
      dir,
      adapter,
      brain: args.includes('--narrate') ? anthropicBrain() : undefined,
      stamp: new Date().toISOString().slice(0, 10),
    });
    await writeFile(join(dir, 'SPEC.md'), md);
    console.error('[probevane] wrote SPEC.md');
  }

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
