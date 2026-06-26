import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brain } from '../brain/brain.js';
import type { StackAdapter, TestKind, RunScope } from '../adapters/adapter.js';
import { extractTestBlock, conventionalSpecPath } from './extract.js';
import { auditFiles } from '../audit/core.js';
import { firstFailure } from './runes/validation_gate.js';

// Per-target LOCAL drafter ($0) for the easy band. NOT the full gated loop (small
// models choke on it) — a FOCUSED single-target flow: minimal prompt + the target
// source → local model emits one fenced test → extract → write → verify with the
// SAME gates (suite green + audit clean), with a couple of repair turns. Easy,
// low-fact modules only (see triage.isEasyTarget); anything it can't land falls
// back to the bridge.

const DRAFT_SYSTEM = `You write ONE test file. Use ONLY the real exported names and literal values from the SOURCE below — do not invent identifiers or values. Assert concrete values; cover the happy path, edge cases, and error cases. Output the COMPLETE test file as a SINGLE fenced code block (start it with a \`// <path>\` comment) and NOTHING else.`;

export interface DraftResult {
  accepted: boolean;
  specPath: string;
  reason: string;
}

export async function draftLocal(opts: {
  dir: string;
  target: { sourcePath: string; name: string };
  kind: TestKind;
  adapter: StackAdapter;
  brain: Brain;
  maxRepairs?: number;
  log?: (l: string) => void;
}): Promise<DraftResult> {
  const { dir, target, kind, adapter, brain } = opts;
  const log = opts.log ?? (() => {});
  const scope: RunScope = kind === 'e2e' ? 'e2e' : 'unit';
  const specPath = conventionalSpecPath(adapter.id, target.sourcePath);
  const abs = join(dir, specPath);
  const source = await readFile(join(dir, target.sourcePath), 'utf8').catch(() => '');
  if (!source) return { accepted: false, specPath, reason: 'unreadable source' };

  const placement = adapter.guidance(kind);
  let feedback = '';
  const maxRepairs = opts.maxRepairs ?? 2;

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const user =
      `Write a ${kind} test ${placement}\nTarget: ${target.sourcePath}\n\n=== SOURCE ===\n${source.slice(0, 4000)}` +
      (feedback ? `\n\n=== YOUR PREVIOUS ATTEMPT FAILED ===\n${feedback}\nFix it and output the full file again.` : '');
    const resp = await brain.complete({ system: DRAFT_SYSTEM, messages: [{ role: 'user', text: user }], tools: [] });
    const ex = extractTestBlock(resp.text);
    if (!ex) { feedback = 'No fenced code block found. Output ONLY one fenced test file.'; continue; }

    await writeFile(abs, ex.code);
    const run = await adapter.run(dir, scope, [specPath]).catch(() => ({ green: false, passed: 0, failed: 1, raw: '' } as any));
    const report = await auditFiles([abs], adapter.auditRules()).catch(() => ({ errors: 0 } as any));
    if (run.green && report.errors === 0) {
      log(`[draft-local] ✓ ${specPath} (attempt ${attempt + 1})`);
      return { accepted: true, specPath, reason: 'green + audit-clean' };
    }
    feedback = run.green
      ? `audit: ${report.errors} violation(s).`
      : `FIX THIS FIRST:\n${firstFailure(run.raw) ?? `${run.failed} failing test(s)`}`;
    log(`[draft-local] ✗ ${specPath} attempt ${attempt + 1}: ${run.green ? 'audit' : 'red'}`);
  }

  await rm(abs, { force: true }); // local couldn't land it — leave nothing for the bridge to trip on
  return { accepted: false, specPath, reason: 'local could not produce a green+clean test' };
}
