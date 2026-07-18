import type { Rune } from './rune.js';
import type { TestKind, RunScope } from '../adapters/adapter.js';
import type { AcceptanceOpts } from './runes/index.js';
import {
  contextInject, pathGuard, planFirst, noRegression, validationGate, auditGate,
  acceptanceGate, oracleGate, hermeticGate, mutationGate, a11yGate, visualGate, flakeGate,
  redFirst, qualityGate, mfeGate, assertionGate, structureGate, euphonyGate,
  sessionDiary, caveatHarvest, distillTrace, libraryPromote,
} from './runes/index.js';
import type { ProfileOpts, Segment, SubroutineId } from './profile-types.js';

// Profile subroutines — the proven, reused rune sequences the generated
// profiles.gen.ts composes from. This is the CONDITIONAL layer (flag-toggled
// assembly); the declarative top layer lives in vane/profiles.vane. Split out
// of profiles.ts so the codegen can import them without touching hand code.

/** Build the opt-in quality gate (or [] when off). */
function maybeQuality(q: ProfileOpts['quality']): Rune[] {
  if (!q) return [];
  return [qualityGate(typeof q === 'object' ? q : undefined)];
}

/** Build the opt-in MFE standards gate (or [] when off; itself a no-op off-federation). */
function maybeMfe(on: boolean | undefined): Rune[] {
  return on ? [mfeGate()] : [];
}

/** Setup: context + write-scope guard + plan gate, with optional TDD red gate / regression guard. */
export function preamble(kind: TestKind, o: { redFirst?: boolean; noRegression?: boolean } = {}): Rune[] {
  return [
    contextInject(kind),
    pathGuard,
    ...(o.redFirst ? [redFirst()] : []),
    planFirst,
    ...(o.noRegression ? [noRegression()] : []),
  ];
}

/** Green-suite gate stack: fast validation → static audit → hermetic → optional acceptance. */
export function greenGates(scope: RunScope, o: { fullSuite?: boolean; acceptance?: AcceptanceOpts } = {}): Rune[] {
  return [
    validationGate(scope, o.fullSuite),
    auditGate,
    hermeticGate,
    ...(o.acceptance ? [acceptanceGate(o.acceptance)] : []),
    oracleGate(), // ADR-022 Phase 1 — self-configuring from the target's config.oracles (no-op when none)
  ];
}

/** The write_tests-only extras suite (flake/assert/mutation/a11y/visual gates). */
function extraGates(opts: ProfileOpts, scope: RunScope): Rune[] {
  const out: Rune[] = [];
  if (opts.flakeGuard) out.push(flakeGate(3, opts.flakeTolerance ?? 0));
  if (opts.assertMin) out.push(assertionGate(opts.assertMin));
  if (opts.mutation) out.push(mutationGate({ enforce: true }));
  if (opts.a11y) out.push(a11yGate);
  if (opts.visual && scope === 'e2e') out.push(visualGate);
  return out;
}

/** Opt-in gates. `extras` adds the write_tests-only suite; quality/mfe/structure
 *  are available to every profile that passes the matching opt. */
export function optInGates(opts: ProfileOpts, scope: RunScope, o: { extras?: boolean; mfe?: boolean } = {}): Rune[] {
  const out: Rune[] = o.extras ? extraGates(opts, scope) : [];
  out.push(...maybeQuality(opts.quality));
  if (o.mfe) out.push(...maybeMfe(opts.mfe));
  if (opts.structure) out.push(structureGate());
  if (opts.euphony) out.push(euphonyGate());
  return out;
}

/** Harvest tail. `full` adds distill + library-promote on top of diary + caveat. */
export function harvest(o: { full?: boolean } = {}): Rune[] {
  return [sessionDiary, caveatHarvest, ...(o.full ? [distillTrace, libraryPromote] : [])];
}

/** Wrap a labelled run of Runes as a pipeline segment. */
export function seg(sub: SubroutineId, runes: Rune[]): Segment {
  return { sub, runes };
}
