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

// probevane generate <dir> [--kind unit|e2e] [--model …] [--max-steps N] [--max-targets N]
//   [--min-tests N] [--min-coverage P] [--strict]
//   --strict: correctness floor — enforce the mutation gate + steer the model to kill
//             surviving mutants (the suite must CATCH bugs, not just run green).
//
// Precedence for every option: CLI flag > probevane.config.{ts,json} > default.

type Cfg = Awaited<ReturnType<typeof loadConfig>>;
type Adapter = Awaited<ReturnType<typeof selectAdapterOrThrow>>;
type GenOpts = Parameters<typeof generateTests>[0];
type Outcome = Awaited<ReturnType<typeof generateTests>>;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const num = (s?: string) => (s !== undefined ? parseInt(s, 10) : undefined);

function resolveKind(args: string[], cfg: Cfg): TestKind {
  return (flag(args, '--kind') ?? cfg.kind ?? 'unit') as TestKind;
}

// --model auto (default) detects complex code and routes it to a stronger
// model up front; or pin haiku|sonnet|opus|<id>. With no flag/config, an
// improve-cycle-promoted model (model.json) becomes the default.
async function resolveModel(args: string[], cfg: Cfg): Promise<string> {
  const { readModelPointer } = await import('../distill/improve.js');
  return flag(args, '--model') ?? cfg.model ?? (await readModelPointer()) ?? 'auto';
}

// Build the per-dir generate options (a closure so passk can re-target a copy).
// Explicit --takeover overrides the escalation tier.
function buildGenOpts(
  args: string[],
  cfg: Cfg,
  adapter: Adapter,
  kind: TestKind,
  model: string,
): (d: string) => GenOpts {
  const maxSteps = pick(num(flag(args, '--max-steps')), cfg.maxSteps, 30)!;
  const maxTargets = pick(num(flag(args, '--max-targets')), cfg.maxTargets, 8)!;
  const minTests = pick(num(flag(args, '--min-tests')), cfg.minTests, kind === 'e2e' ? 1 : 5)!;
  const minCoverage = pick(num(flag(args, '--min-coverage')), cfg.minCoverage);
  // --strict: turn on the CORRECTNESS floor (KB: default gates measure well-formedness,
  // not correctness). Enforces the mutation gate + proactively steers the model to kill
  // surviving mutants. Off for casual runs (mutation re-runs the suite per mutant).
  const strict = args.includes('--strict') || cfg.strict === true;
  const mutation = strict || args.includes('--mutation') || cfg.mutation === true;
  const mock = args.includes('--mock') || (!args.includes('--no-mock') && (cfg.mock ?? kind === 'unit'));
  const targetGaps = args.includes('--target-gaps');
  const flakeGuard = args.includes('--flake-guard') || cfg.flakeGuard === true;
  const a11y = args.includes('--a11y') || cfg.a11y === true;
  const visual = args.includes('--visual') || cfg.visual === true;
  const budget = pick(num(flag(args, '--budget')), cfg.budget);
  const takeoverOverride = flag(args, '--takeover');
  return (d: string) => ({
    dir: d,
    kind,
    adapter,
    model,
    // Resolve --takeover through brainFor (NOT anthropicBrain directly) so
    // `--takeover ollama`/`openai:`/`local:` route to their backend + haiku/
    // sonnet/opus hit their alias — an all-ollama hybrid needs a non-Anthropic
    // rescue tier.
    takeoverBrain: takeoverOverride && takeoverOverride !== 'none' ? brainFor(takeoverOverride) : undefined,
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
    mutationTarget: strict || args.includes('--mutation-target'),
    log: (l: string) => console.error(l),
  });
}

// Easy-band triage (dry run): classify discovered targets into local-draftable
// (pure, low-fact, $0) vs bridge-needed (IO/component/fact-heavy).
async function runTriage(args: string[], dir: string, kind: TestKind, adapter: Adapter): Promise<void> {
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
}

// Hybrid: local model drafts the easy/pure band ($0), bridge/paid handles the rest.
interface HybridOpts {
  args: string[];
  dir: string;
  kind: TestKind;
  adapter: Adapter;
  model: string;
  genOpts: (d: string) => GenOpts;
}

async function runHybrid(o: HybridOpts): Promise<void> {
  const { args, dir, kind, adapter, model, genOpts } = o;
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
    (t) =>
      draftLocal({ dir, target: t, kind, adapter, brain: localBrain, log: (l) => console.error(l) })
        .catch(() => ({ accepted: false } as any)),
    conc,
  );
  const localOk = drafts.filter((r) => r.accepted).length;
  console.error(`[hybrid] local landed ${localOk}/${easy.length} easy targets ($0). Bridge handles the rest…`);
  const out = await generateTests(genOpts(dir));
  console.log(`[hybrid] DONE: local ${localOk}/${easy.length} easy ($0) + bridge ${out.accepted ? 'ACCEPTED' : out.stopReason} on the rest. Cost: probevane history`);
}

// Shape B: --delegate hands the WHOLE task to an external harness (claude -p),
// then runs probevane's gates on the diff.
async function runDelegate(
  args: string[],
  dir: string,
  kind: TestKind,
  adapter: Adapter,
  model: string,
): Promise<void> {
  const { runDelegated } = await import('../loop/delegate.js');
  const ccModel = model.startsWith('cc:') ? model.slice(3) : model === 'claude-code' ? undefined : 'sonnet';
  const out = await runDelegated({
    dir,
    kind,
    adapter,
    model: ccModel,
    only: flag(args, '--only'),
    maxRounds: num(flag(args, '--rounds')) ?? 3,
    log: (l) => console.error(l),
  });
  console.log(
    `[probevane] DELEGATE ${out.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} rounds=${out.rounds} ` +
      `specs=${out.changedFiles.length} green=${out.green} auditErr=${out.auditErrors} cost=$${out.costUsd.toFixed(4)}`,
  );
  if (!out.accepted) process.exit(1);
}

// pass@k: sample K candidate suites, keep the best-scoring one.
interface PasskOpts {
  args: string[];
  dir: string;
  kind: TestKind;
  adapter: Adapter;
  passk: number;
  genOpts: (d: string) => GenOpts;
}

async function runPassk(o: PasskOpts): Promise<void> {
  const { args, dir, kind, adapter, passk, genOpts } = o;
  const { passKGenerate } = await import('../loop/passk.js');
  const { best } = await passKGenerate({
    dir, kind, adapter, k: passk,
    generate: async (cand) => (await generateTests(genOpts(cand))).accepted,
    log: (l) => console.error(l),
  });
  const verdict = best
    ? `selected ${best.label} (value=${best.score.value}, tests=${best.score.tests}, cov=${best.score.coverage}%)`
    : 'no acceptable candidate';
  console.log(`[probevane] pass@${passk}: ${verdict}`);
  if (!best) process.exit(1);
}

// Machine-readable result (for `probevane factory`). Prefer the signals the gates
// already captured; only measure what's missing, once.
async function maybeReport(
  args: string[],
  dir: string,
  kind: TestKind,
  adapter: Adapter,
  outcome: Outcome,
): Promise<void> {
  const reportPath = flag(args, '--report');
  if (!reportPath) return;
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
    JSON.stringify(
      { accepted: outcome.accepted, stopReason: outcome.stopReason, tests: tests ?? 0, coverage: coverage ?? null },
      null,
      2,
    ),
  );
}

// Autonomous delivery: on accept, branch + commit + open a PR for this run.
async function maybeShip(args: string[], dir: string, outcome: Outcome): Promise<void> {
  if (!(args.includes('--ship') && outcome.accepted)) return;
  const { shipRun, latestDiary } = await import('../ship/ship.js');
  const diary = await latestDiary(dir);
  if (!diary) return;
  const r = await shipRun(
    dir,
    diary,
    { op: 'generate', repo: dir, tests: outcome.tests, coverage: outcome.coverage, cost: undefined },
    (l) => console.error(l),
  );
  console.log(`[probevane] ship: ${r.shipped ? r.prUrl ?? r.branch ?? 'delivered' : 'skipped — ' + r.reason}`);
}

// Produce/refresh the project spec as part of the run.
async function maybeSpec(args: string[], dir: string, adapter: Adapter): Promise<void> {
  if (!args.includes('--spec')) return;
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

async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const cfg = await loadConfig(dir);
  const kind = resolveKind(args, cfg);
  const adapter = await selectAdapterOrThrow(dir);
  const model = await resolveModel(args, cfg);
  console.error(`[probevane] generate kind=${kind} adapter=${adapter.id} model=${model} dir=${dir}`);
  const genOpts = buildGenOpts(args, cfg, adapter, kind, model);

  if (args.includes('--triage')) return runTriage(args, dir, kind, adapter);
  if (args.includes('--hybrid')) return runHybrid({ args, dir, kind, adapter, model, genOpts });
  if (args.includes('--delegate')) return runDelegate(args, dir, kind, adapter, model);
  const passk = parseInt(flag(args, '--passk') ?? '1', 10);
  if (passk > 1) return runPassk({ args, dir, kind, adapter, passk, genOpts });

  const outcome = await generateTests(genOpts(dir));

  console.log(
    `[probevane] ${outcome.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} (${outcome.stopReason}) ` +
      `steps=${outcome.steps} toolCalls=${outcome.toolCalls} gateBlocks=${outcome.gateBlocks} ` +
      `tokens=${outcome.tokensIn}/${outcome.tokensOut} cacheRead=${outcome.cacheRead}${outcome.tookOver ? ' (took over)' : ''}`,
  );

  await maybeReport(args, dir, kind, adapter, outcome);
  await maybeShip(args, dir, outcome);
  await maybeSpec(args, dir, adapter);

  if (!outcome.accepted) process.exit(1);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
