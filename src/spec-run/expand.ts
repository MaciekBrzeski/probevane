import type { RunSpec } from './runspec.js';
import type { PlanItem } from '../commands/plan/build.js';

// Decompose one RunSpec into many single-file child specs — the reliability core
// for a weak (ollama) executor. A big "add tests to the repo" prompt becomes N
// narrow `generate --only <file> --max-targets 1` runs, each small enough that the
// model finishes or fails *deterministically* (difficulty/stuck) instead of
// stalling on a sprawling multi-file task. Children inherit the parent's floors +
// budget; buildPlan already priority-orders the targets.

/** One child spec per generate-able plan target. Non-decomposable specs
 *  (decompose.perFile === false, or a task path) return as a single unit. */
export function expandSpec(parent: RunSpec, planItems: PlanItem[]): RunSpec[] {
  if (!parent.decompose?.perFile) return [parent];
  if (parent.path !== 'write_tests') return [parent]; // task paths run whole — see plan's honesty note

  const targets = planItems.filter((i) => i.action === 'generate');
  return targets.map((item, n) => ({
    ...parent,
    id: `${parent.id}-${String(n + 1).padStart(3, '0')}`,
    only: item.target,
    // Thin-but-tested files (coverage gap) → steer at the uncovered lines only.
    targetGaps: item.why === 'coverage gap',
    decompose: { perFile: false },
  }));
}

/** Headline of a decomposition: how many units, and of what. */
export function expandSummary(children: RunSpec[]): string {
  const gaps = children.filter((c) => c.targetGaps).length;
  const fresh = children.length - gaps;
  return `${children.length} unit(s): ${fresh} new-file, ${gaps} coverage-gap`;
}
