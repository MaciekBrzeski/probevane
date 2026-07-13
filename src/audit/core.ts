import { readFile } from 'node:fs/promises';
import type { AuditRule } from '../adapters/adapter.js';

// Language-agnostic audit engine — ported from qaforge/src/cli/audit.ts.
// Adapters supply the rules (auditRules()); this scans files line-by-line and
// collects violations. Suppression: a line, or the line directly above, holding
// "probevane-allow: <rule-id>" silences that rule on that line.

export interface Violation {
  file: string;
  line: number;
  rule: string;
  severity: 'error' | 'warn';
  message: string;
}

/** Rolled-up result of one audit pass — what auditFiles hands the audit gate. */
export interface AuditReport {
  violations: Violation[];
  errors: number;
  warns: number;
  filesChecked: number;
  /** 0..5 quality score (5 = clean). Mirrors the improvement-log scale. */
  score: number;
}

// Scan one file line-by-line against the rules; returns every unsuppressed violation.
export function auditSource(file: string, source: string, rules: AuditRule[]): Violation[] {
  const lines = source.split('\n');
  const viols: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1] ?? '';
    for (const rule of rules) {
      if (suppressed(line, prev, rule.id)) continue;
      const msg = rule.check(line, i + 1, file, source);
      if (msg) viols.push({ file, line: i + 1, rule: rule.id, severity: rule.severity, message: msg });
    }
  }
  return viols;
}

// Audit many files and roll violations into a scored report — the audit gate's input.
export async function auditFiles(files: string[], rules: AuditRule[]): Promise<AuditReport> {
  const violations: Violation[] = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8').catch(() => '');
    if (src) violations.push(...auditSource(f, src, rules));
  }
  const errors = violations.filter((v) => v.severity === 'error').length;
  const warns = violations.filter((v) => v.severity === 'warn').length;
  return {
    violations,
    errors,
    warns,
    filesChecked: files.length,
    score: scoreFrom(errors, warns),
  };
}

// 5 clean; each error -1.5, each warn -0.5; floored at 0.
function scoreFrom(errors: number, warns: number): number {
  const s = 5 - errors * 1.5 - warns * 0.5;
  return Math.max(0, Math.round(s * 10) / 10);
}

// "probevane-allow: <rule-id>" on the line (or the one above) silences that rule there.
function suppressed(line: string, prev: string, ruleId: string): boolean {
  const needle = `probevane-allow: ${ruleId}`;
  return line.includes(needle) || prev.includes(needle);
}

// One grep-able line per violation — the feedback text logs and gate messages show.
export function formatViolations(v: Violation[]): string {
  return v.map((x) => `${x.file}:${x.line}: ${x.severity}: [${x.rule}] ${x.message}`).join('\n');
}
