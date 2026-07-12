import type { StackAdapter, TestKind, ProbeResult, TestTarget } from '../../adapters/adapter.js';
import type { Brain } from '../../brain/brain.js';
import { profile } from '../profiles.js';
import { runLoop, type RunOutcome } from '../engine/index.js';
import { retrieveFewShot } from '../../library/retrieve.js';
import { readTraces } from '../../distill/collect.js';
import { pickSimilarTrace } from '../../library/similar.js';
import { conventionalSpecPath } from '../extract.js';
import { propertyGuidance } from '../property.js';
import { mockInject } from '../runes/mock_inject.js';
import { buildChain } from '../../mock/index.js';
import { brainFor, isDirectModel } from '../../brain/select.js';
import { assessComplexity, routeModels } from '../complexity.js';
import { parseGaps, gapsDigest } from '../../coverage/gaps.js';
import type { RunCtx } from '../ctx.js';
import type { Rune } from '../rune.js';

// Shared generation core used by both `probevane generate` and the live eval.
// Probe-grounds the task, then runs the gated write_tests loop.
export interface GenerateOpts {
  dir: string;
  kind: TestKind;
  adapter: StackAdapter;
  /** Explicit primary brain. If omitted, resolved from `model` after discovery. */
  brain?: Brain;
  takeoverBrain?: Brain;
  /** 'auto' (default) routes complex code to a stronger model; or haiku/sonnet/opus/<id>. */
  model?: string;
  maxSteps?: number;
  maxTargets?: number;
  only?: string; // filter discovered targets by path substring
  minTests?: number;
  minCoverage?: number;
  mutation?: boolean;
  flakeGuard?: boolean;
  a11y?: boolean;
  visual?: boolean;
  flakeTolerance?: number; // allow K outlier runs in the flake gate
  assertMin?: number; // assertion-quality floor (0..100) fed back into the loop
  quality?: boolean; // opt-in source-quality gate (no-op for tests; useful with --target-gaps source edits)
  budget?: number;
  mock?: boolean; // synthesize + inject mocks (network/deps), enforce hermeticity
  targetGaps?: boolean; // run coverage first + steer the model at uncovered lines
  property?: boolean; // teach property/invariant testing (prefer for pure functions)
  mutationTarget?: boolean; // find surviving mutants first, steer the model to kill them
  log?: (l: string) => void;
}

// Discover → filter → slice → probe each target; refuse to guess if none probe.
async function probeTargets(
  opts: GenerateOpts,
  log: (l: string) => void,
): Promise<{ probes: ProbeResult[]; probedTargets: TestTarget[] }> {
  const { dir, kind, adapter } = opts;
  let discovered = await adapter.discover(dir, kind);
  if (opts.only) discovered = discovered.filter((t) => t.sourcePath.includes(opts.only!));
  const targets = discovered.slice(0, opts.maxTargets ?? 8);
  const probes: ProbeResult[] = [];
  const probedTargets: TestTarget[] = [];
  for (const t of targets) {
    const p = await adapter.probe(dir, t);
    if (p.ok) { probes.push(p); probedTargets.push(t); }
    else log(`[probevane] probe skipped ${t.sourcePath}: ${p.error}`);
  }
  if (probes.length === 0) throw new Error('no probeable targets found — refusing to guess');
  log(`[probevane] probed ${probes.length}/${targets.length} target(s)`);
  return { probes, probedTargets };
}

// Auto model routing: now that we know the targets, detect complex code and
// start on a stronger brain instead of waiting for the loop to stall.
async function resolveBrains(
  opts: GenerateOpts,
  probedTargets: TestTarget[],
  log: (l: string) => void,
): Promise<{ brain: Brain; takeoverBrain?: Brain }> {
  let brain = opts.brain;
  let takeoverBrain = opts.takeoverBrain;
  if (!brain) {
    const cx = await assessComplexity(opts.dir, probedTargets);
    const route = routeModels(opts.model ?? 'auto', cx.complex);
    const explicitLocal = isDirectModel(opts.model);
    brain = brainFor(explicitLocal ? opts.model : route.primary);
    takeoverBrain = takeoverBrain ?? brainFor(route.takeover); // keep an explicit --takeover
    log(`[probevane] model=${brain.model}${cx.complex ? ` (complex: ${cx.reasons.join(', ')})` : ' (simple)'} takeover=${takeoverBrain.model}`);
  }
  return { brain, takeoverBrain };
}

// Optional grounding passes: coverage-gap targeting, mutation-driven targeting,
// and the mock maker. Each is a no-op unless its flag is set; returns the prompt
// fragments plus the mock_inject rune to splice into the pipeline.
async function buildGrounds(
  opts: GenerateOpts,
  log: (l: string) => void,
): Promise<{ gapGround: string; mutantGround: string; mockGround: string; mockRune?: Rune }> {
  const { dir, adapter } = opts;
  let gapGround = '';
  if (opts.targetGaps) {
    await adapter.coverage(dir).catch(() => null);
    const gaps = await parseGaps(dir).catch(() => []);
    const d = gapsDigest(gaps);
    if (d) { gapGround = `\n\n=== ${d}`; log(`[probevane] ${gaps.length} file(s) with coverage gaps`); }
  }
  // Mutation-driven targeting: find mutants the current suite misses, steer the
  // model to write tests that kill them (the strongest "does it catch bugs" signal).
  let mutantGround = '';
  if (opts.mutationTarget) {
    const { survivingMutants, mutantDigest } = await import('../mutation.js');
    const surv = await survivingMutants(dir, adapter).catch(() => []);
    const d = mutantDigest(surv);
    if (d) { mutantGround = `\n\n=== ${d}`; log(`[probevane] ${surv.length} surviving mutant(s) to target`); }
  }
  // Mock maker: synthesize the app's mock boundary, write MSW handlers, and
  // prepare a rune that injects the plan. hermetic_gate then enforces use.
  let mockRune: Rune | undefined;
  let mockGround = '';
  if (opts.mock) {
    const plan = await buildChain(dir); // synth + materialize fixtures + capture contracts + write handlers
    if (plan.handlers.length)
      log(
        `[probevane] synthesized ${plan.handlers.length} MSW handler(s), ${Object.keys(plan.fixtures ?? {}).length} fixture(s), ${Object.keys(plan.outputs ?? {}).length} contract(s)`,
      );
    mockRune = mockInject(plan);
    mockGround = `\n\n=== MOCKS + CHAIN (use these; tests must be hermetic) ===\n${plan.digest}`;
  }
  return { gapGround, mutantGround, mockGround, mockRune };
}

// Assemble the loop task prompt from the placement guidance, probe ground truth,
// and any optional grounding fragments.
function buildTask(
  opts: GenerateOpts,
  kind: TestKind,
  placement: string,
  ground: string,
  grounds: { mockGround: string; gapGround: string; mutantGround: string },
): string {
  return [
    `Add ${kind} tests to this project. Use ONLY the ground truth below — do not import or`,
    `reference any symbol, prop, role, or label not listed. Read a sibling spec first if one exists`,
    `to match the project's style. Record a plan, then write well-asserted ${kind} tests`,
    placement,
    ``,
    `RULES: Write ONE spec file. Never create empty or placeholder test files — every file you write`,
    `must contain real, runnable tests. When the tests are complete, STOP CALLING TOOLS so the`,
    `validation + audit + acceptance gates can run; fix only what they report.`,
    opts.property ? `\n${propertyGuidance()}` : '',
    ``,
    `=== GROUND TRUTH ===`,
    ground,
    grounds.mockGround,
    grounds.gapGround,
    grounds.mutantGround,
  ].join('\n');
}

// Consult: when stalled, surface the most-similar WORKED EXAMPLE for this
// module. Prefer an accepted trace closest to this task (exemplar-RAG helps
// novel local-solve, and only on retry — the consult ladder is that retry);
// fall back to the curated library few-shot if no trace matches.
function makeOnConsult(kind: TestKind): (ctx: RunCtx) => Promise<string | undefined> {
  return async (ctx: RunCtx): Promise<string | undefined> => {
    const traces = await readTraces().catch(() => []);
    const hit = pickSimilarTrace(traces, ctx.task, ctx.adapter.id);
    if (hit) {
      return `WORKED EXAMPLE from a similar module (match its shape, adapt to THIS module's symbols):\n\n${hit.spec.slice(0, 2500)}`;
    }
    const ex = await retrieveFewShot({ stack: ctx.adapter.id, kind, topK: 1 }).catch(() => []);
    if (!ex.length) return undefined;
    return `A known-good ${kind} example for this stack (match its shape):\n\n${ex[0].body.slice(0, 2500)}`;
  };
}

// Build the write_tests pipeline; splice mock_inject right after context_inject
// (index 0) so its guidance lands early.
function buildRunes(opts: GenerateOpts, kind: TestKind, mockRune?: Rune): Rune[] {
  const runes = profile('write_tests', {
    kind,
    minTests: opts.minTests,
    minCoverage: opts.minCoverage,
    mutation: opts.mutation,
    flakeGuard: opts.flakeGuard,
    a11y: opts.a11y,
    visual: opts.visual,
    quality: opts.quality,
    flakeTolerance: opts.flakeTolerance,
    assertMin: opts.assertMin,
  });
  if (mockRune) runes.splice(1, 0, mockRune);
  return runes;
}

// NOTE: tried injecting the target SOURCE here (tighter ground-truth so small
// models bind real facts instead of inventing them) — it BACKFIRED: +3k chars
// overwhelmed the 3B (capacity wall) → it wrote nothing at all. Facts were
// already available; the small model can't bind them, and more context makes it
// worse. Reverted. (A capable model reads the source via read_file anyway.)
// Non-tool-calling local models (text-extract mode): the base "work by calling
// tools" framing steers them into tool-prose, which extracts to nothing. Tell
// them to emit the spec as ONE fenced block (with a path comment) instead.
function finalTaskFor(textExtract: boolean, task: string, specPathHint: string | undefined): string {
  return textExtract
    ? `${task}\n\nOUTPUT FORMAT: You CANNOT call tools here. Write the COMPLETE test file as ONE fenced \`\`\`${specPathHint?.endsWith('.py') ? 'python' : 'ts'} code block, starting with a \`// ${specPathHint ?? 'spec'}\` comment line, and output NOTHING else — no prose. It is saved automatically; fix it next turn if a gate reports a failure.`
    : task;
}

export async function generateTests(opts: GenerateOpts): Promise<RunOutcome> {
  const { dir, kind, adapter } = opts;
  const log = opts.log ?? (() => {});

  // Toolchain bootstrap before probing/gating (idempotent) — see runPath.
  await adapter.install(dir).catch((e) => log(`[generate] install: ${e}`));
  const { probes, probedTargets } = await probeTargets(opts, log);
  const { brain, takeoverBrain } = await resolveBrains(opts, probedTargets, log);

  const ground = probes.map((p) => p.digest).join('\n\n');
  const placement = adapter.guidance(kind); // stack-specific framework + placement
  const grounds = await buildGrounds(opts, log);
  const task = buildTask(opts, kind, placement, ground, grounds);

  const onConsult = makeOnConsult(kind);
  const runes = buildRunes(opts, kind, grounds.mockRune);

  // Text-extract fallback for non-tool-calling local models (openai-compat):
  // accept a fenced test block as a write. Hint the spec path from the first
  // probed target's stack convention (used only when the block names none).
  const textExtract = brain.id === 'openai-compat' || takeoverBrain?.id === 'openai-compat';
  const specPathHint = probedTargets[0]
    ? conventionalSpecPath(adapter.id, probedTargets[0].sourcePath)
    : undefined;
  const finalTask = finalTaskFor(textExtract, task, specPathHint);

  return runLoop({
    workdir: dir,
    adapter,
    brain,
    takeoverBrain,
    onConsult,
    textExtract,
    minimalSystem: textExtract, // small local models: focused prompt, gates still verify
    specPathHint,
    runes,
    task: finalTask,
    label: `${kind === 'e2e' ? 'generate-e2e' : 'generate'}:${dir.split('/').pop()}`,
    maxSteps: opts.maxSteps ?? 30,
    forceStopAfter: 8, // real apps need a few more barren turns to converge before giving up
    budget: opts.budget,
    log,
  });
}
