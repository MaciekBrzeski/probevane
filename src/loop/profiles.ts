import type { Rune } from './rune.js';
import type { TestKind, RunScope } from '../adapters/adapter.js';
import type { AcceptanceOpts } from './runes/acceptance_gate.js';
import {
  contextInject, pathGuard, planFirst, noRegression, validationGate, auditGate,
  acceptanceGate, hermeticGate, mutationGate, a11yGate, visualGate, flakeGate,
  behaviorLock, redFirst, qualityGate, mfeGate, assertionGate, renderGate,
  sessionDiary, caveatHarvest, distillTrace, libraryPromote,
} from './runes/index.js';
import type { RenderGateOpts } from './runes/index.js';
import type { QualityConfig } from '../quality/analyze.js';

// Profiles — ordered Rune pipelines per task type (ported from runestone
// profiles.rs). beforeToolCall order: plan_first → no_regression. shouldStop
// order: validation (fast fail) → audit (static) → acceptance (count/coverage).
export type ProfileName = 'write_tests' | 'refactor' | 'feature' | 'repair' | 'fix' | 'migrate' | 'document' | 'visual' | 'bare';

export interface ProfileOpts {
  kind: TestKind;
  minTests?: number;
  minCoverage?: number;
  shellChecks?: string[];
  mutation?: boolean; // opt-in mutation gate (slow)
  flakeGuard?: boolean; // opt-in flake gate (runs new specs N times)
  flakeTolerance?: number; // allow up to K outlier runs in the flake gate (default 0)
  assertMin?: number; // opt-in assertion-quality floor (0..100) fed back into the loop
  a11y?: boolean; // opt-in a11y gate (component specs must assert accessibility)
  visual?: boolean; // opt-in visual gate (e2e specs must capture a screenshot checkpoint)
  quality?: boolean | Partial<QualityConfig>; // opt-in source-quality gate (edited files mustn't regress)
  mfe?: boolean; // opt-in micro-frontend (Module Federation) standards gate
  render?: RenderGateOpts; // the visual path's render/vision acceptance oracle
}

/** Build the opt-in quality gate (or [] when off). */
function maybeQuality(q: ProfileOpts['quality']) {
  if (!q) return [];
  return [qualityGate(typeof q === 'object' ? q : undefined)];
}

/** Build the opt-in MFE standards gate (or [] when off; itself a no-op off-federation). */
function maybeMfe(on: boolean | undefined) {
  return on ? [mfeGate()] : [];
}

// --- Subroutines: proven, reused rune sequences. Profiles compose from these
// (via profileSegments below). Each returns a contiguous run of Runes; the
// boundaries are what describe.ts buckets into named subroutines for the graph. ---

/** Subroutine identities — a labelled segment of a profile's pipeline. */
export type SubroutineId = 'preamble' | 'green-gates' | 'safety-net' | 'opt-in' | 'harvest';

/** Setup: context + write-scope guard + plan gate, with optional TDD red gate / regression guard. */
function preamble(kind: TestKind, o: { redFirst?: boolean; noRegression?: boolean } = {}): Rune[] {
  return [
    contextInject(kind),
    pathGuard,
    ...(o.redFirst ? [redFirst()] : []),
    planFirst,
    ...(o.noRegression ? [noRegression()] : []),
  ];
}

/** Green-suite gate stack: fast validation → static audit → hermetic → optional acceptance. */
function greenGates(scope: RunScope, o: { fullSuite?: boolean; acceptance?: AcceptanceOpts } = {}): Rune[] {
  return [
    validationGate(scope, o.fullSuite),
    auditGate,
    hermeticGate,
    ...(o.acceptance ? [acceptanceGate(o.acceptance)] : []),
  ];
}

/** Opt-in gates. `extras` adds the write_tests-only suite (flake/assert/mutation/a11y/visual). */
function optInGates(opts: ProfileOpts, scope: RunScope, o: { extras?: boolean; mfe?: boolean } = {}): Rune[] {
  const out: Rune[] = [];
  if (o.extras) {
    if (opts.flakeGuard) out.push(flakeGate(3, opts.flakeTolerance ?? 0));
    if (opts.assertMin) out.push(assertionGate(opts.assertMin));
    if (opts.mutation) out.push(mutationGate({ enforce: true }));
    if (opts.a11y) out.push(a11yGate);
    if (opts.visual && scope === 'e2e') out.push(visualGate);
  }
  out.push(...maybeQuality(opts.quality));
  if (o.mfe) out.push(...maybeMfe(opts.mfe));
  return out;
}

/** Harvest tail. `full` adds distill + library-promote on top of diary + caveat. */
function harvest(o: { full?: boolean } = {}): Rune[] {
  return [sessionDiary, caveatHarvest, ...(o.full ? [distillTrace, libraryPromote] : [])];
}

export interface Segment {
  sub: SubroutineId;
  runes: Rune[];
}

/** Wrap a labelled run of Runes as a pipeline segment. */
function seg(sub: SubroutineId, runes: Rune[]): Segment {
  return { sub, runes };
}

function writeTestsSegments(opts: ProfileOpts, scope: RunScope): Segment[] {
  return [
    seg('preamble', preamble(opts.kind, { noRegression: true })),
    seg('green-gates', greenGates(scope, {
      acceptance: { scope, minTests: opts.minTests, minCoverage: opts.minCoverage, shellChecks: opts.shellChecks },
    })),
    // write_tests carries the full extras suite but NOT the mfe gate.
    seg('opt-in', optInGates(opts, scope, { extras: true })),
    seg('harvest', harvest({ full: true })),
  ];
}

function featureSegments(opts: ProfileOpts): Segment[] {
  // TDD red-first: failing spec → implement → green, existing tests protected.
  return [
    seg('preamble', preamble('unit', { redFirst: true, noRegression: true })),
    seg('green-gates', greenGates('unit', { acceptance: { scope: 'unit', minTests: opts.minTests ?? 1 } })),
    seg('opt-in', optInGates(opts, 'unit', { mfe: true })),
    seg('harvest', harvest({ full: true })),
  ];
}

function repairSegments(opts: ProfileOpts): Segment[] {
  // Get the whole suite green + clean again after a source change / review fix.
  return [
    seg('preamble', preamble('unit')),
    seg('green-gates', greenGates('unit', { fullSuite: true })), // full suite must be green
    seg('opt-in', optInGates(opts, 'unit', { mfe: true })),
    seg('harvest', harvest({ full: true })),
  ];
}

function refactorSegments(opts: ProfileOpts): Segment[] {
  // Characterization-first: tests are the contract, source is what changes.
  return [
    seg('preamble', preamble('unit')),
    seg('safety-net', [behaviorLock()]),
    seg('opt-in', optInGates(opts, 'unit', { mfe: true })),
    seg('harvest', harvest()),
  ];
}

function documentSegments(opts: ProfileOpts): Segment[] {
  // Add docs/JSDoc only — no behavior change: tests + typecheck stay green.
  return [
    seg('preamble', preamble('unit')),
    seg('safety-net', [behaviorLock()]),
    seg('harvest', harvest()),
  ];
}

function visualSegments(opts: ProfileOpts): Segment[] {
  // Visual/graphics change: edit render/shader/material source, existing suite +
  // typecheck stay green (behavior_lock), and the acceptance oracle is NOT a test
  // count but render_gate — the running app must screenshot cleanly + a vision
  // reviewer must judge it matches the goal (+ optional perf budget).
  return [
    seg('preamble', preamble('unit')),
    seg('safety-net', [behaviorLock()]),
    ...(opts.render ? [seg('green-gates', [renderGate(opts.render)])] : []),
    seg('harvest', harvest()),
  ];
}

/**
 * The profile's pipeline as labelled subroutine segments — the single source of
 * truth. `profile()` is just this flattened; describe.ts reads each rune's
 * subroutine off the segment it came from (no second mapping to drift).
 */
const SEGMENT_BUILDERS: Record<ProfileName, (opts: ProfileOpts, scope: RunScope) => Segment[]> = {
  write_tests: writeTestsSegments,
  feature: featureSegments,
  repair: repairSegments,
  fix: repairSegments,
  refactor: refactorSegments,
  migrate: refactorSegments,
  document: documentSegments,
  visual: visualSegments,
  bare: () => [],
};

export function profileSegments(name: ProfileName, opts: ProfileOpts): Segment[] {
  const scope: RunScope = opts.kind === 'e2e' ? 'e2e' : 'unit';
  return SEGMENT_BUILDERS[name](opts, scope);
}

export function profile(name: ProfileName, opts: ProfileOpts): Rune[] {
  return profileSegments(name, opts).flatMap((s) => s.runes);
}
