import type { Rune } from './rune.js';
import type { RunScope } from '../adapters/adapter.js';
import type { ProfileName, ProfileOpts, Segment } from './profile-types.js';
import { SEGMENT_BUILDERS } from './profiles.gen.js';

// Profiles — ordered Rune pipelines per task type (ported from runestone
// profiles.rs). The pipeline COMPOSITIONS are declared in vane/profiles.vane
// and generated into profiles.gen.ts; the conditional subroutines live in
// profile-subs.ts; this facade keeps the public API (and every importer)
// exactly where it always was.
export type { ProfileName, ProfileOpts, SubroutineId, Segment } from './profile-types.js';

/** Assemble a profile's labelled segments — the single source of truth for its pipeline. */
export function profileSegments(name: ProfileName, opts: ProfileOpts): Segment[] {
  const scope: RunScope = opts.kind === 'e2e' ? 'e2e' : 'unit';
  return SEGMENT_BUILDERS[name](opts, scope);
}

/** The runnable pipeline: profileSegments flattened. */
export function profile(name: ProfileName, opts: ProfileOpts): Rune[] {
  return profileSegments(name, opts).flatMap((s) => s.runes);
}
