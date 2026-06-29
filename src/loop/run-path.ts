import type { StackAdapter } from '../adapters/adapter.js';
import { brainFor } from '../brain/select.js';
import { assessComplexity, routeModels } from './complexity.js';
import { profile, type ProfileName, type ProfileOpts } from './profiles.js';
import { runLoop, type RunOutcome } from './engine.js';
import { buildGraph } from '../mock/graph.js';
import { focusDirective } from './scout.js';
import { buildDepDigest } from './dep-digest.js';
import { runInWorktree } from './worktree.js';
import { reviewDiffText } from '../review/diff-review.js';

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
  mfe?: boolean; // opt-in micro-frontend (Module Federation) standards gate
  forceStopAfter?: number; // barren-turn ceiling (raise for big-repo refactors that read/plan a lot before editing)
  only?: string; // focus path — narrows context + injects a repo-map so the model edits instead of crawling
  worktree?: boolean; // run in an isolated git worktree (safe before/after; live tree untouched)
  worktreeMerge?: boolean; // on accept, auto-merge the worktree branch back
  worktreeReview?: boolean; // self-review the accepted diff (always on when worktreeMerge — gates the merge)
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

  // --only: narrow the model's focus to one path + its importers, and hand it a
  // repo-map up front so it edits instead of crawling the whole repo (the
  // large-repo read-stall fix). buildGraph is best-effort.
  let task = opts.task;
  if (opts.only) {
    const graph = await buildGraph(opts.dir).catch(() => null);
    task += focusDirective(graph, opts.only);
    // Inject the focus file's dependency APIs (workspace pkgs + relative modules
    // it imports) so the model doesn't need to read them — removes the read-thrash
    // + wrong-shape-guess failure mode (complements workspace-scoped reads).
    let depBlock = '';
    try { depBlock = buildDepDigest(opts.dir, opts.only); } catch { /* best-effort */ }
    task += depBlock;
    log(`[probevane] focus: ${opts.only}${graph ? ' (repo-map injected)' : ''}${depBlock ? ' (+dep APIs)' : ''}`);
  }

  const doRun = (workdir: string) => runLoop({
    workdir,
    adapter: opts.adapter,
    brain,
    takeoverBrain,
    runes: profile(opts.profileName, { kind: 'unit', quality: opts.quality, mfe: opts.mfe }),
    task,
    label: `${opts.profileName}:${opts.dir.split('/').pop()}`,
    maxSteps: opts.maxSteps ?? 30,
    forceStopAfter: opts.forceStopAfter ?? 8,
    budget: opts.budget,
    log,
  });

  // --worktree: isolate the run in a throwaway git worktree (live tree untouched
  // until an explicit merge). Otherwise edit the live workdir in place. A merge
  // is always self-reviewed first (and blocked on review errors); --worktree-review
  // surfaces the review without merging.
  if (!opts.worktree) return doRun(opts.dir);
  const wantReview = opts.worktreeReview || opts.worktreeMerge;
  return runInWorktree(opts.dir, opts.profileName, doRun, {
    merge: opts.worktreeMerge,
    review: wantReview ? (diff: string) => reviewDiffText(diff, takeoverBrain) : undefined,
    log,
  });
}
