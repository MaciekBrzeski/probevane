import { readdir, access } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Shared contract + tiny helpers for the doctor checks (checks.ts + lanes.ts).

export type DoctorSeverity = 'error' | 'warn';

/** One diagnosis: which check fired, how bad, and what to do about it.
 *  Produced by every check; printed (and possibly fixed) by the doctor CLI. */
export interface DoctorFinding {
  check: string;
  severity: DoctorSeverity;
  message: string;
  /** Set when --fix can resolve this automatically. */
  fixable?: boolean;
  /** Exact remediation for the human when not auto-fixable (or after --fix). */
  hint?: string;
}

/** An executable remediation paired with its finding — `--fix` runs apply()
 *  and prints the returned one-liner. */
export interface DoctorFix {
  finding: DoctorFinding;
  apply: () => Promise<string>; // returns a one-line "what happened"
}

/** What a check (and the merged doctor run) returns: findings to print plus
 *  the fixes `--fix` may apply. */
export interface DoctorReport {
  findings: DoctorFinding[];
  fixes: DoctorFix[];
}

export const exists = (p: string) => access(p).then(() => true).catch(() => false);

/** Last non-empty line of a command's output, capped at 160 chars — the one
 *  line worth quoting in a finding. */
export function lastLine(s: string | undefined): string {
  const lines = (s ?? '').trim().split('\n').filter(Boolean);
  return (lines[lines.length - 1] ?? '').slice(0, 160);
}

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', '__pycache__', '.venv']);
/** Recursive file walk returning root-relative paths, skipping generated and
 *  vendored dirs — the file inventory the checks scan. */
export async function walkSrc(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) out.push(...(await walkSrc(root, join(dir, e.name))));
    } else {
      out.push(relative(root, join(dir, e.name)));
    }
  }
  return out;
}
