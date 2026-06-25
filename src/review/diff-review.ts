import { sh } from '../util/exec.js';
import type { Brain } from '../brain/brain.js';

// LLM code review over a PR diff → structured findings. One brain call (not the
// full loop). Findings feed the `fix` path for auto-remediation.
export interface Finding {
  file: string;
  line?: number;
  severity: 'error' | 'warn' | 'nit';
  issue: string;
  fix: string;
}

const SYSTEM = `You are a precise senior code reviewer. Review the unified diff and report real problems only:
bugs, missing edge cases/error handling, broken or missing tests, security issues, and clear quality defects.
Skip style nits unless they change meaning. Reply with ONLY a JSON array of findings, each:
{ "file": string, "line": number|null, "severity": "error"|"warn"|"nit", "issue": string, "fix": string }
No prose, no markdown fences — just the JSON array (or [] if the diff is clean).`;

export async function getDiff(dir: string, base: string): Promise<string> {
  const d = await sh(`git diff ${base} -- . ':(exclude)node_modules' ':(exclude)*.lock' ':(exclude)package-lock.json'`, dir);
  return (d.stdout || '').slice(0, 60_000);
}

export async function reviewDiffText(diff: string, brain: Brain): Promise<Finding[]> {
  if (!diff.trim()) return [];
  const resp = await brain
    .complete({ system: SYSTEM, messages: [{ role: 'user', text: `Review this diff:\n\n${diff}` }], tools: [] })
    .catch(() => null);
  return parseFindings(resp?.text ?? '');
}

export async function reviewDiff(dir: string, base: string, brain: Brain): Promise<Finding[]> {
  return reviewDiffText(await getDiff(dir, base), brain);
}

export function parseFindings(text: string): Finding[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((f) => f && f.file && f.issue)
      .map((f) => ({
        file: String(f.file),
        line: typeof f.line === 'number' ? f.line : undefined,
        severity: ['error', 'warn', 'nit'].includes(f.severity) ? f.severity : 'warn',
        issue: String(f.issue),
        fix: String(f.fix ?? ''),
      }));
  } catch {
    return [];
  }
}

export function findingsMarkdown(findings: Finding[]): string {
  if (!findings.length) return '### 🔍 probevane review\n\n✅ No issues found in the diff.\n';
  const icon = { error: '🛑', warn: '⚠️', nit: '💡' };
  const lines = ['### 🔍 probevane review', '', `${findings.length} finding(s):`, ''];
  for (const f of findings) lines.push(`- ${icon[f.severity]} \`${f.file}${f.line ? ':' + f.line : ''}\` — ${f.issue}${f.fix ? ` → ${f.fix}` : ''}`);
  return lines.join('\n') + '\n';
}

export function findingsTask(findings: Finding[]): string {
  return [
    `A code review found the following issues. Fix each in the source (or tests where the test is wrong).`,
    `Keep the whole test suite green and audit-clean. Do not suppress or weaken tests to hide a problem.`,
    ``,
    ...findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? ':' + f.line : ''} — ${f.issue}${f.fix ? ` (suggested: ${f.fix})` : ''}`),
  ].join('\n');
}
