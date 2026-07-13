import type { MfeViolation } from './standards.js';

// Pure rollup for the `mfe` driver (Phase D). Kept separate from driver.ts (the
// process/fs orchestration) so it's unit-testable and counted toward coverage.

export interface MfeDriverResult {
  repo: string;
  isMfe: boolean; // false → no federation config (skipped)
  name?: string;
  errorsBefore?: number;
  errorsAfter?: number; // set when a fix stage re-audited
  warns?: number;
  grade?: number;
  stages: string[]; // stages that ran, e.g. ['audit','contract','fix']
  stageErrors?: string[]; // stages that failed (e.g. 'generate: exit 1')
}

/** The fleet-level rollup the `mfe` command prints/persists. Filled by aggregateMfe
 *  from the per-repo results + the cross-repo version-align pass. */
export interface MfeDriverReport {
  ts: string;
  repos: number;
  mfeRepos: number;
  totalErrors: number; // current errors (errorsAfter ?? errorsBefore) summed
  improved: number; // repos where a fix lowered the error count
  avgGrade: number; // mean grade over MFE repos
  byStage: Record<string, number>; // how many repos ran each stage
  versionAlign: MfeViolation[];
  results: MfeDriverResult[];
}

/** Current error count of a repo (post-fix if a fix ran, else the baseline). */
function currentErrors(r: MfeDriverResult): number {
  return r.errorsAfter ?? r.errorsBefore ?? 0;
}

/** Fold per-repo results into the fleet report: stage counts, improved (a fix
 *  lowered the error count), avg grade over MFE repos only — non-MFE repos are
 *  counted but excluded from grading so skips don't drag the average. */
export function aggregateMfe(
  results: MfeDriverResult[],
  versionAlign: MfeViolation[],
  ts: string,
): MfeDriverReport {
  const mfe = results.filter((r) => r.isMfe);
  const byStage: Record<string, number> = {};
  for (const r of results) for (const s of r.stages) byStage[s] = (byStage[s] ?? 0) + 1;
  const improved = mfe.filter(
    (r) => r.errorsAfter !== undefined && r.errorsAfter < (r.errorsBefore ?? 0),
  ).length;
  const avgGrade = mfe.length
    ? Math.round(mfe.reduce((a, r) => a + (r.grade ?? 0), 0) / mfe.length)
    : 0;
  return {
    ts,
    repos: results.length,
    mfeRepos: mfe.length,
    totalErrors: mfe.reduce((a, r) => a + currentErrors(r), 0),
    improved,
    avgGrade,
    byStage,
    versionAlign,
    results,
  };
}
