import type { StackAdapter } from '../adapters/adapter.js';
import { brainFor } from '../brain/select.js';
import { assessComplexity, routeModels } from './complexity.js';
import { profile, type ProfileName, type ProfileOpts } from './profiles.js';
import { runLoop, type RunOutcome } from './engine.js';

// Generic single-task path runner — shared by refactor / feature / repair. (The
// test-generation path keeps its richer probe-grounding in run-generation.ts.)
// Resolves the model from complexity, then runs the chosen profile on a task.
export interface RunPathOpts {
  dir: string;
  adapter: StackAdapter;
  profileName: ProfileName;
  task: string;
  model?: string; // auto | haiku | sonnet | opus | <id>
  maxSteps?: number;
  budget?: number;
  quality?: ProfileOpts['quality']; // opt-in source-quality gate
  forceStopAfter?: number; // barren-turn ceiling (raise for big-repo refactors that read/plan a lot before editing)
  log?: (l: string) => void;
}

export async function runPath(opts: RunPathOpts): Promise<RunOutcome> {
  const log = opts.log ?? (() => {});
  // No specific targets here — route on the app's graph complexity. Refactor and
  // feature work is generally harder than test-writing, so a mid app already
  // tips to the stronger model.
  const cx = await assessComplexity(opts.dir, []);
  const route = routeModels(opts.model ?? 'auto', cx.complex);
  const brain = brainFor(opts.model?.startsWith('local:') || opts.model?.startsWith('openai:') ? opts.model : route.primary);
  const takeoverBrain = brainFor(route.takeover);
  log(`[probevane] model=${brain.model}${cx.complex ? ` (complex: ${cx.reasons.join(', ')})` : ''} takeover=${takeoverBrain.model}`);

  return runLoop({
    workdir: opts.dir,
    adapter: opts.adapter,
    brain,
    takeoverBrain,
    runes: profile(opts.profileName, { kind: 'unit', quality: opts.quality }),
    task: opts.task,
    label: `${opts.profileName}:${opts.dir.split('/').pop()}`,
    maxSteps: opts.maxSteps ?? 30,
    forceStopAfter: opts.forceStopAfter ?? 8,
    budget: opts.budget,
    log,
  });
}
