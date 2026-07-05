import { readdir, access } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Shared contract + tiny helpers for the doctor checks (checks.ts + lanes.ts).

export type DoctorSeverity = 'error' | 'warn';

export interface DoctorFinding {
  check: string;
  severity: DoctorSeverity;
  message: string;
  /** Set when --fix can resolve this automatically. */
  fixable?: boolean;
  /** Exact remediation for the human when not auto-fixable (or after --fix). */
  hint?: string;
}

export interface DoctorFix {
  finding: DoctorFinding;
  apply: () => Promise<string>; // returns a one-line "what happened"
}

export interface DoctorReport {
  findings: DoctorFinding[];
  fixes: DoctorFix[];
}

export const exists = (p: string) => access(p).then(() => true).catch(() => false);

export function lastLine(s: string | undefined): string {
  const lines = (s ?? '').trim().split('\n').filter(Boolean);
  return (lines[lines.length - 1] ?? '').slice(0, 160);
}

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', '__pycache__', '.venv']);
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
