import type { Rune } from './rune.js';
import type { TestKind, RunScope } from '../adapters/adapter.js';
import { contextInject } from './runes/context_inject.js';
import { pathGuard } from './runes/path_guard.js';
import { planFirst } from './runes/plan_first.js';
import { noRegression } from './runes/no_regression.js';
import { validationGate } from './runes/validation_gate.js';
import { auditGate } from './runes/audit_gate.js';
import { acceptanceGate } from './runes/acceptance_gate.js';
import { hermeticGate } from './runes/hermetic_gate.js';
import { mutationGate } from './runes/mutation_gate.js';
import { a11yGate } from './runes/a11y_gate.js';
import { visualGate } from './runes/visual_gate.js';
import { flakeGate } from './runes/flake_gate.js';
import { behaviorLock } from './runes/behavior_lock.js';
import { redFirst } from './runes/red_first.js';
import { qualityGate } from './runes/quality_gate.js';
import type { QualityConfig } from '../quality/analyze.js';
import { sessionDiary } from './runes/session_diary.js';
import { caveatHarvest } from './runes/caveat_harvest.js';
import { distillTrace } from './runes/distill_trace.js';
import { libraryPromote } from './runes/library_promote.js';

// Profiles — ordered Rune pipelines per task type (ported from runestone
// profiles.rs). beforeToolCall order: plan_first → no_regression. shouldStop
// order: validation (fast fail) → audit (static) → acceptance (count/coverage).
export type ProfileName = 'write_tests' | 'refactor' | 'feature' | 'repair' | 'fix' | 'bare';

export interface ProfileOpts {
  kind: TestKind;
  minTests?: number;
  minCoverage?: number;
  shellChecks?: string[];
  mutation?: boolean; // opt-in mutation gate (slow)
  flakeGuard?: boolean; // opt-in flake gate (runs new specs N times)
  a11y?: boolean; // opt-in a11y gate (component specs must assert accessibility)
  visual?: boolean; // opt-in visual gate (e2e specs must capture a screenshot checkpoint)
  quality?: boolean | Partial<QualityConfig>; // opt-in source-quality gate (edited files mustn't regress)
}

/** Build the opt-in quality gate (or [] when off). */
function maybeQuality(q: ProfileOpts['quality']) {
  if (!q) return [];
  return [qualityGate(typeof q === 'object' ? q : undefined)];
}

export function profile(name: ProfileName, opts: ProfileOpts): Rune[] {
  const scope: RunScope = opts.kind === 'e2e' ? 'e2e' : 'unit';
  switch (name) {
    case 'write_tests':
      return [
        contextInject(opts.kind),
        pathGuard,
        planFirst,
        noRegression(),
        validationGate(scope),
        auditGate,
        hermeticGate,
        acceptanceGate({
          scope,
          minTests: opts.minTests,
          minCoverage: opts.minCoverage,
          shellChecks: opts.shellChecks,
        }),
        ...(opts.flakeGuard ? [flakeGate()] : []),
        ...(opts.mutation ? [mutationGate({ enforce: true })] : []),
        ...(opts.a11y ? [a11yGate] : []),
        ...(opts.visual && scope === 'e2e' ? [visualGate] : []),
        ...maybeQuality(opts.quality),
        sessionDiary,
        caveatHarvest,
        distillTrace,
        libraryPromote,
      ];
    case 'refactor':
      // Characterization-first: tests are the contract, source is what changes.
      return [
        contextInject('unit'),
        pathGuard,
        planFirst,
        behaviorLock(),
        ...maybeQuality(opts.quality),
        sessionDiary,
        caveatHarvest,
      ];
    case 'feature':
      // TDD red-first: failing spec → implement → green, existing tests protected.
      return [
        contextInject('unit'),
        pathGuard,
        redFirst(),
        planFirst,
        noRegression(),
        validationGate('unit'),
        auditGate,
        hermeticGate,
        acceptanceGate({ scope: 'unit', minTests: opts.minTests ?? 1 }),
        ...maybeQuality(opts.quality),
        sessionDiary,
        caveatHarvest,
        distillTrace,
        libraryPromote,
      ];
    case 'repair':
      // Update affected specs so the whole suite is green again after a source change.
      return [
        contextInject('unit'),
        pathGuard,
        planFirst,
        validationGate('unit', true), // full suite must be green
        auditGate,
        hermeticGate,
        ...maybeQuality(opts.quality),
        sessionDiary,
        caveatHarvest,
        distillTrace,
        libraryPromote,
      ];
    case 'fix':
      // Apply review findings (source or tests), keep the whole suite green + clean.
      return [
        contextInject('unit'),
        pathGuard,
        planFirst,
        validationGate('unit', true), // full suite must stay green
        auditGate,
        hermeticGate,
        ...maybeQuality(opts.quality),
        sessionDiary,
        caveatHarvest,
        distillTrace,
        libraryPromote,
      ];
    case 'bare':
      return [];
  }
}
