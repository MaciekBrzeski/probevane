import { brainFor } from '../brain/select.js';
import { selectAdapterOrThrow } from '../adapters/registry.js';
import { generateTests } from '../loop/run/generation.js';
import { loadConfig, pick } from '../util/config.js';
import type { TestKind } from '../adapters/adapter.js';
import { flag } from '../util/args.js';

// Option assembly for `probevane generate` — flag > config > default for every
// knob, split out of generate.ts (which keeps the orchestration).

type Cfg = Awaited<ReturnType<typeof loadConfig>>;
type Adapter = Awaited<ReturnType<typeof selectAdapterOrThrow>>;
type GenOpts = Parameters<typeof generateTests>[0];

const num = (s?: string) => (s !== undefined ? parseInt(s, 10) : undefined);
// Flag > config > default resolution for the generate-loop knobs.
function resolveGenFlags(args: string[], cfg: Cfg, kind: TestKind) {
  // --strict: turn on the CORRECTNESS floor (KB: default gates measure well-formedness,
  // not correctness). Enforces the mutation gate + proactively steers the model to kill
  // surviving mutants. Off for casual runs (mutation re-runs the suite per mutant).
  const strict = args.includes('--strict') || cfg.strict === true;
  return {
    strict,
    maxSteps: pick(num(flag(args, '--max-steps')), cfg.maxSteps, 30)!,
    maxTargets: pick(num(flag(args, '--max-targets')), cfg.maxTargets, 8)!,
    minTests: pick(num(flag(args, '--min-tests')), cfg.minTests, kind === 'e2e' ? 1 : 5)!,
    minCoverage: pick(num(flag(args, '--min-coverage')), cfg.minCoverage),
    mutation: strict || args.includes('--mutation') || cfg.mutation === true,
    mock: args.includes('--mock') || (!args.includes('--no-mock') && (cfg.mock ?? kind === 'unit')),
    targetGaps: args.includes('--target-gaps'),
    flakeGuard: args.includes('--flake-guard') || cfg.flakeGuard === true,
    a11y: args.includes('--a11y') || cfg.a11y === true,
    visual: args.includes('--visual') || cfg.visual === true,
    budget: pick(num(flag(args, '--budget')), cfg.budget),
  };
}

// Build the per-dir generate options, returned as a closure so pass@k can
// re-target candidate copies with identical knobs. Explicit --takeover overrides
// the escalation tier.
export function buildGenOpts(
  args: string[],
  cfg: Cfg,
  adapter: Adapter,
  kind: TestKind,
  model: string,
): (d: string) => GenOpts {
  const {
    strict, maxSteps, maxTargets, minTests, minCoverage, mutation, mock, targetGaps, flakeGuard, a11y, visual, budget,
  } =
    resolveGenFlags(args, cfg, kind);
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
    structure: args.includes('--structure') || cfg.structure === true,
    euphony: args.includes('--euphony') || cfg.euphony === true,
    budget,
    mock,
    targetGaps,
    property: args.includes('--property'),
    mutationTarget: strict || args.includes('--mutation-target'),
    log: (l: string) => console.error(l),
  });
}
