import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { topDir } from '../arch/metrics.js';
import type { MutationRun } from './mutation.js';

// Mutation ratchet: a per-top-dir score floor persisted as an accepted baseline,
// so CI fails only when a directory REGRESSES below its recorded floor — a
// can-only-improve gate that localizes the regression, instead of one brittle
// global --min-score. Mirrors the quality ratchet (src/quality/baseline.ts): the
// same write / read / check shape, keyed on a stable bucket (topDir) not a line.

const BASELINE_FILE = '.probevane/mutation-baseline.json';
// killed/total is an exact rational; this epsilon only absorbs float print/parse
// noise so an unchanged score never reads as a regression.
const EPS = 1e-9;

/** Per-dir tally + score, aggregated from a run's per-file counts. */
export interface DirScore {
  total: number;
  killed: number;
  score: number;
}

/** Roll the run's per-file tallies up to top-level dirs (src/loop/x.ts → "loop",
 *  engine/core/x.ts → "engine"). Empty dirs (total 0) can't be scored, so the
 *  aggregate only contains dirs that had at least one mutated site. */
export function byDir(run: MutationRun): Record<string, DirScore> {
  const acc: Record<string, { total: number; killed: number }> = {};
  for (const [file, v] of Object.entries(run.byFile)) {
    const d = topDir(file);
    const cur = acc[d] ?? (acc[d] = { total: 0, killed: 0 });
    cur.total += v.total;
    cur.killed += v.killed;
  }
  const out: Record<string, DirScore> = {};
  for (const [d, v] of Object.entries(acc))
    out[d] = { total: v.total, killed: v.killed, score: v.total ? v.killed / v.total : 1 };
  return out;
}

/** Where the ratchet file lives inside the target project. */
function baselinePath(dir: string): string {
  return join(dir, BASELINE_FILE);
}

/** Floors are rounded DOWN to 0.1 bands and CAPPED at 0.9. The site list is
 *  budget-sampled, so it drifts as code is added/removed and per-dir scores wobble
 *  a few percent between commits; a 0.1 band absorbs that noise while still catching
 *  a real regression (a directory dropping a whole band). The 0.9 cap means a
 *  perfectly-killed dir never demands a brittle 1.0 (one survivor under a shifted
 *  sample would trip it) — the 90↔100 gap is within sampling noise. Gradual
 *  within-band drift is tracked by the improvement-log time-series, not this gate. */
export function floorBand(score: number): number {
  return Math.min(0.9, Math.floor(score * 10) / 10);
}

/** Record the run's per-dir scores (rounded to 0.1 bands) as the accepted floors.
 *  Returns the number of dirs written. */
export function writeMutationBaseline(dir: string, run: MutationRun): number {
  const floors: Record<string, number> = {};
  for (const [d, s] of Object.entries(byDir(run))) floors[d] = floorBand(s.score);
  mkdirSync(join(dir, '.probevane'), { recursive: true });
  writeFileSync(baselinePath(dir), JSON.stringify(floors, null, 2) + '\n');
  return Object.keys(floors).length;
}

/** Load the accepted per-dir floors; undefined when none was ever written (or it
 *  is unreadable) — callers then treat the ratchet as a no-op. */
export function readMutationBaseline(dir: string): Record<string, number> | undefined {
  try {
    return JSON.parse(readFileSync(baselinePath(dir), 'utf8')) as Record<string, number>;
  } catch {
    return undefined;
  }
}

/** One directory whose current score fell below its recorded floor. */
export interface Regression {
  dir: string;
  floor: number;
  actual: number;
}

/** Directories that regressed below their baseline floor. A dir only present in
 *  the baseline but absent from this run (0 sites sampled) is skipped — we can't
 *  judge it. A dir new since the baseline has no floor, so it's allowed. When no
 *  baseline exists the ratchet is a no-op (empty list). */
export function checkRatchet(run: MutationRun, baseline: Record<string, number> | undefined): Regression[] {
  if (!baseline) return [];
  const scores = byDir(run);
  const regressions: Regression[] = [];
  for (const [dir, floor] of Object.entries(baseline)) {
    const cur = scores[dir];
    if (!cur) continue; // not sampled this run — nothing to compare
    if (cur.score < floor - EPS) regressions.push({ dir, floor, actual: cur.score });
  }
  return regressions;
}
