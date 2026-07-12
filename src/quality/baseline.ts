import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { QViolation, QualityReport } from './analyze.js';

// Quality ratchet: persist the CURRENT set of violation keys as an accepted
// baseline, then suppress those keys on later runs so the gate reflects only NEW
// violations. Keys strip the changing "(N > M)" tail so an unchanged or
// line-shifted violation keeps the same key (NOT keyed on line number).

const BASELINE_FILE = '.probevane/quality-baseline.json';

/** Stable, line-shift-robust key for a violation. */
export function violationKey(v: QViolation): string {
  const what = v.message.replace(/\(\d+ > \d+\)/, '').trim();
  return `${v.file}::${v.rule}::${what}`;
}

/** Where the ratchet file lives inside the target project. */
function baselinePath(dir: string): string {
  return join(dir, BASELINE_FILE);
}

/** Persist the report's violation keys; returns how many were written. */
export function writeBaseline(dir: string, report: QualityReport): number {
  const keys = [...new Set(report.violations.map(violationKey))];
  mkdirSync(join(dir, '.probevane'), { recursive: true });
  writeFileSync(baselinePath(dir), JSON.stringify(keys, null, 2));
  return keys.length;
}

/** Load the accepted key set; undefined when no baseline was ever written
 *  (or it is unreadable) — callers then leave the report untouched. */
function readBaseline(dir: string): Set<string> | undefined {
  try {
    return new Set(JSON.parse(readFileSync(baselinePath(dir), 'utf8')) as string[]);
  } catch {
    return undefined;
  }
}

/** Remove baselined violations and recompute errors/warns/score. Returns the
 *  report unchanged when no baseline file exists. */
export function applyBaseline(dir: string, report: QualityReport): QualityReport {
  const base = readBaseline(dir);
  if (!base) return report;
  const violations = report.violations.filter((v) => !base.has(violationKey(v)));
  const errors = violations.filter((v) => v.severity === 'error').length;
  const warns = violations.filter((v) => v.severity === 'warn').length;
  const score = Math.max(0, 100 - errors * 5 - warns * 2);
  return { ...report, violations, errors, warns, score };
}
