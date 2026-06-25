import { resolve } from 'node:path';
import { selectAdapterOrThrow } from '../adapters/registry.js';
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
    budget,
    mock,
    targetGaps,
    log: (l: string) => console.error(l),
  });

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
