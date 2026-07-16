import type { Rune } from './rune.js';
import type { TestKind } from '../adapters/adapter.js';
import type { RenderGateOpts } from './runes/index.js';
import type { QualityConfig } from '../quality/analyze.js';

// Profile type surface — split from profiles.ts so the generated
// profiles.gen.ts, the hand-written subroutines, and every existing importer
// share one definition without touching the generated file.

/** The task paths a pipeline can be assembled for. */
export type ProfileName = 'write_tests' | 'refactor' | 'feature' | 'repair' | 'fix' | 'migrate' | 'document' | 'visual' | 'bare';

/** Everything a profile assembly can be tuned with — test kind + acceptance floors +
 *  the opt-in gate toggles. Filled from CLI flags / config by the run entrypoints. */
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

/** Subroutine identities — a labelled segment of a profile's pipeline. */
export type SubroutineId = 'preamble' | 'green-gates' | 'safety-net' | 'opt-in' | 'harvest';

/** A labelled contiguous run of runes — what describe.ts buckets into subroutines. */
export interface Segment {
  sub: SubroutineId;
  runes: Rune[];
}
