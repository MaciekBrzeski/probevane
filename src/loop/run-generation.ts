import type { StackAdapter, TestKind } from '../adapters/adapter.js';
import type { Brain } from '../brain/brain.js';
import { profile } from './profiles.js';
import { runLoop, type RunOutcome } from './engine.js';
import { retrieveFewShot } from '../library/retrieve.js';
import { readTraces } from '../distill/collect.js';
import { pickSimilarTrace } from '../library/similar.js';
import { conventionalSpecPath } from './extract.js';
import { mockInject } from './runes/mock_inject.js';
import { buildChain } from '../mock/index.js';
import { brainFor } from '../brain/select.js';
import { assessComplexity, routeModels } from './complexity.js';
import { parseGaps, gapsDigest } from '../coverage/gaps.js';
import type { RunCtx } from './ctx.js';

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
  budget?: number;
  mock?: boolean; // synthesize + inject mocks (network/deps), enforce hermeticity
  targetGaps?: boolean; // run coverage first + steer the model at uncovered lines
  log?: (l: string) => void;
}

export async function generateTests(opts: GenerateOpts): Promise<RunOutcome> {
  const { dir, kind, adapter } = opts;
  const log = opts.log ?? (() => {});

  let discovered = await adapter.discover(dir, kind);
  if (opts.only) discovered = discovered.filter((t) => t.sourcePath.includes(opts.only!));
  const targets = discovered.slice(0, opts.maxTargets ?? 8);
  const probes = [];
  const probedTargets = [];
  for (const t of targets) {
    const p = await adapter.probe(dir, t);
    if (p.ok) { probes.push(p); probedTargets.push(t); }
    else log(`[probevane] probe skipped ${t.sourcePath}: ${p.error}`);
  }
  if (probes.length === 0) throw new Error('no probeable targets found — refusing to guess');
  log(`[probevane] probed ${probes.length}/${targets.length} target(s)`);

  // Auto model routing: now that we know the targets, detect complex code and
  // start on a stronger brain instead of waiting for the loop to stall.
  let brain = opts.brain;
  let takeoverBrain = opts.takeoverBrain;
  if (!brain) {
    const cx = await assessComplexity(dir, probedTargets);
    const route = routeModels(opts.model ?? 'auto', cx.complex);
    const explicitLocal = opts.model?.startsWith('local:') || opts.model?.startsWith('openai:');
    brain = brainFor(explicitLocal ? opts.model : route.primary);
    takeoverBrain = takeoverBrain ?? brainFor(route.takeover); // keep an explicit --takeover
    log(`[probevane] model=${brain.model}${cx.complex ? ` (complex: ${cx.reasons.join(', ')})` : ' (simple)'} takeover=${takeoverBrain.model}`);
  }

  const ground = probes.map((p) => p.digest).join('\n\n');
  const placement = adapter.guidance(kind); // stack-specific framework + placement

  // Coverage-gap targeting: run coverage once, steer the model at uncovered lines.
  let gapGround = '';
  if (opts.targetGaps) {
    await adapter.coverage(dir).catch(() => null);
    const gaps = await parseGaps(dir).catch(() => []);
    const d = gapsDigest(gaps);
    if (d) { gapGround = `\n\n=== ${d}`; log(`[probevane] ${gaps.length} file(s) with coverage gaps`); }
  }

  // Mock maker: synthesize the app's mock boundary, write MSW handlers, and
  // prepare a rune that injects the plan. hermetic_gate then enforces use.
  let mockRune;
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

  const task = [
    `Add ${kind} tests to this project. Use ONLY the ground truth below — do not import or`,
    `reference any symbol, prop, role, or label not listed. Read a sibling spec first if one exists`,
    `to match the project's style. Record a plan, then write well-asserted ${kind} tests`,
    placement,
    ``,
    `RULES: Write ONE spec file. Never create empty or placeholder test files — every file you write`,
    `must contain real, runnable tests. When the tests are complete, STOP CALLING TOOLS so the`,
    `validation + audit + acceptance gates can run; fix only what they report.`,
    ``,
    `=== GROUND TRUTH ===`,
    ground,
    mockGround,
    gapGround,
  ].join('\n');

  // Consult: when stalled, surface the most-similar WORKED EXAMPLE for this
  // module. Prefer an accepted trace closest to this task (exemplar-RAG helps
  // novel local-solve, and only on retry — the consult ladder is that retry);
  // fall back to the curated library few-shot if no trace matches.
  const onConsult = async (ctx: RunCtx): Promise<string | undefined> => {
    const traces = await readTraces().catch(() => []);
    const hit = pickSimilarTrace(traces, ctx.task, ctx.adapter.id);
    if (hit) {
      return `WORKED EXAMPLE from a similar module (match its shape, adapt to THIS module's symbols):\n\n${hit.spec.slice(0, 2500)}`;
    }
    const ex = await retrieveFewShot({ stack: ctx.adapter.id, kind, topK: 1 }).catch(() => []);
    if (!ex.length) return undefined;
    return `A known-good ${kind} example for this stack (match its shape):\n\n${ex[0].body.slice(0, 2500)}`;
  };

  const runes = profile('write_tests', {
    kind,
    minTests: opts.minTests,
    minCoverage: opts.minCoverage,
    mutation: opts.mutation,
    flakeGuard: opts.flakeGuard,
    a11y: opts.a11y,
    visual: opts.visual,
  });
  // Insert mock_inject right after context_inject (index 0) so its guidance lands early.
  if (mockRune) runes.splice(1, 0, mockRune);

  // Text-extract fallback for non-tool-calling local models (openai-compat):
  // accept a fenced test block as a write. Hint the spec path from the first
  // probed target's stack convention (used only when the block names none).
  const textExtract = brain.id === 'openai-compat' || takeoverBrain?.id === 'openai-compat';
  const specPathHint = probedTargets[0]
    ? conventionalSpecPath(adapter.id, probedTargets[0].sourcePath)
    : undefined;
  // Non-tool-calling local models (text-extract mode): the base "work by calling
  // tools" framing steers them into tool-prose, which extracts to nothing. Tell
  // them to emit the spec as ONE fenced block (with a path comment) instead.
  const finalTask = textExtract
    ? `${task}\n\nOUTPUT FORMAT: You CANNOT call tools here. Write the COMPLETE test file as ONE fenced \`\`\`${specPathHint?.endsWith('.py') ? 'python' : 'ts'} code block, starting with a \`// ${specPathHint ?? 'spec'}\` comment line, and output NOTHING else — no prose. It is saved automatically; fix it next turn if a gate reports a failure.`
    : task;

  return runLoop({
    workdir: dir,
    adapter,
    brain,
    takeoverBrain,
    onConsult,
    textExtract,
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
