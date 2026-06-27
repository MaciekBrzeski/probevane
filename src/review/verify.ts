import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brain } from '../brain/brain.js';
import { extractJsonStrict } from '../brain/json.js';
import type { Finding } from './diff-review.js';

// Gate issue-discovery: a finding is not acted on until VERIFIED. Two gates —
//   1. grounding (deterministic): the cited file must exist; if a line is given,
//      it must be in range. Drops hallucinated references for free.
//   2. adversarial refute (LLM): an INDEPENDENT skeptic judges each finding,
//      defaulting to refuted when uncertain. Only survivors are kept.

export async function groundFindings(dir: string, findings: Finding[]): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const f of findings) {
    const src = await readFile(join(dir, f.file), 'utf8').catch(() => null);
    if (src === null) continue; // file doesn't exist → hallucinated reference
    if (f.line !== undefined) {
      const lines = src.split('\n').length;
      if (f.line < 1 || f.line > lines + 1) continue; // line out of range
    }
    out.push(f);
  }
  return out;
}

const VERIFY_SYSTEM = `You are a skeptical reviewer verifying other reviewers' findings against a diff.
For EACH finding decide if it is a REAL, actionable problem in THIS diff. Be adversarial: if a finding
is speculative, already handled, a style nit dressed up as a bug, or you are not sure — mark it NOT real.
Reply with ONLY a JSON array: [{ "index": number, "real": boolean, "reason": string }]. No prose.`;

export async function verifyFindings(findings: Finding[], diff: string, brain: Brain): Promise<Finding[]> {
  if (findings.length === 0) return [];
  const list = findings.map((f, i) => `${i}. [${f.severity}] ${f.file}${f.line ? ':' + f.line : ''} — ${f.issue}`).join('\n');
  const resp = await brain
    .complete({
      system: VERIFY_SYSTEM,
      messages: [{ role: 'user', text: `DIFF:\n${diff.slice(0, 50_000)}\n\nFINDINGS:\n${list}` }],
      tools: [],
    })
    .catch(() => null);
  const verdicts = parseVerdicts(resp?.text ?? '');
  if (verdicts.size === 0) return findings; // verifier unavailable → don't silently drop everything
  return findings.filter((_, i) => verdicts.get(i) === true);
}

export function parseVerdicts(text: string): Map<number, boolean> {
  const out = new Map<number, boolean>();
  const arr = extractJsonStrict(text, (x): x is any[] => Array.isArray(x));
  for (const v of arr ?? []) {
    if (typeof v?.index === 'number') out.set(v.index, v.real === true);
  }
  return out;
}
