import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brain } from '../brain/brain.js';
import type { StackAdapter, TestKind, RunScope } from '../adapters/adapter.js';
import { extractTestBlock, conventionalSpecPath } from './extract.js';
import { auditFiles } from '../audit/core.js';
import { firstFailure } from './runes/validation_gate.js';
import { factDigest } from './fact-digest.js';
import { propertyGuidance, looksPropertyTestable } from './property.js';
import { sh } from '../util/exec.js';

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

// Surgical fact-RAG + optional property guidance: lead with the literal facts
// (const values, type shapes) the test must bind — a small model invents these
// from signatures alone. Compact, so it doesn't re-trigger the whole-source
// length choke. Pure module → property/invariant testing sidesteps guessing
// computed values (the local model's residual wall after fact-RAG binds facts).
function promptBlocks(source: string): { factBlock: string; propBlock: string } {
  const facts = factDigest(source);
  const factBlock = facts
    ? `=== EXACT FACTS (use these literal names + values + shapes; do NOT invent any) ===\n${facts}\n\n`
    : '';
  const propBlock = looksPropertyTestable(source) ? `${propertyGuidance()}\n\n` : '';
  return { factBlock, propBlock };
}

function buildUser(o: {
  kind: TestKind;
  placement: string;
  sourcePath: string;
  propBlock: string;
  factBlock: string;
  source: string;
  feedback: string;
}): string {
  return (
    `Write a ${o.kind} test ${o.placement}\nTarget: ${o.sourcePath}\n\n${o.propBlock}${o.factBlock}=== SOURCE ===\n${o.source.slice(0, 3000)}` +
    (o.feedback
      ? `\n\n=== YOUR PREVIOUS ATTEMPT FAILED ===\n${o.feedback}\nFix it and output the full file again.`
      : '')
  );
}

/** Verify a freshly written draft against the SAME gates the full loop uses:
 *  suite green + audit clean + typecheck clean (typecheck too — suite-green alone
 *  lets a type-dirty test through, e.g. a used-but-unimported type). Returns null
 *  on success, else the repair feedback + a short failure kind for logging. */
async function verifyDraft(o: {
  dir: string;
  specPath: string;
  abs: string;
  scope: RunScope;
  adapter: StackAdapter;
}): Promise<{ feedback: string; kind: string } | null> {
  const { dir, specPath, abs, scope, adapter } = o;
  const run = await adapter
    .run(dir, scope, [specPath])
    .catch(() => ({ green: false, passed: 0, failed: 1, raw: '' } as any));
  const report = await auditFiles([abs], adapter.auditRules()).catch(() => ({ errors: 0 } as any));
  const tc = await sh(adapter.commands().typecheck, dir).catch(() => ({ stdout: '', stderr: '' } as any));
  const tcErrs = (tc.stdout + tc.stderr).split('\n').filter((l: string) => l.includes(specPath) && /error TS/.test(l));
  if (run.green && report.errors === 0 && tcErrs.length === 0) return null;
  const feedback = !run.green
    ? `FIX THIS FIRST:\n${firstFailure(run.raw) ?? `${run.failed} failing test(s)`}`
    : tcErrs.length
      ? `Type errors — fix the imports/types:\n${tcErrs.slice(0, 4).join('\n')}`
      : `audit: ${report.errors} violation(s).`;
  const kind = !run.green ? 'red' : tcErrs.length ? 'type' : 'audit';
  return { feedback, kind };
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
  // Never clobber an existing spec — it may be a real committed test. Skip; the
  // module is already covered. (Bug guard: draftLocal writes/rm's at this path.)
  const exists = await readFile(abs, 'utf8').then(() => true).catch(() => false);
  if (exists) return { accepted: false, specPath, reason: 'spec already exists — skipped (no clobber)' };
  const source = await readFile(join(dir, target.sourcePath), 'utf8').catch(() => '');
  if (!source) return { accepted: false, specPath, reason: 'unreadable source' };

  const placement = adapter.guidance(kind);
  const { factBlock, propBlock } = promptBlocks(source);
  let feedback = '';
  const maxRepairs = opts.maxRepairs ?? 2;

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const user = buildUser({ kind, placement, sourcePath: target.sourcePath, propBlock, factBlock, source, feedback });
    const resp = await brain.complete({ system: DRAFT_SYSTEM, messages: [{ role: 'user', text: user }], tools: [] });
    const ex = extractTestBlock(resp.text);
    if (!ex) { feedback = 'No fenced code block found. Output ONLY one fenced test file.'; continue; }

    await writeFile(abs, ex.code);
    const fail = await verifyDraft({ dir, specPath, abs, scope, adapter });
    if (!fail) {
      log(`[draft-local] ✓ ${specPath} (attempt ${attempt + 1})`);
      return { accepted: true, specPath, reason: 'green + audit + typecheck-clean' };
    }
    feedback = fail.feedback;
    log(`[draft-local] ✗ ${specPath} attempt ${attempt + 1}: ${fail.kind}`);
  }

  // leave nothing for the bridge to trip on (unless inspecting)
  if (process.env.PROBEVANE_KEEP_DRAFT !== '1') await rm(abs, { force: true });
  return { accepted: false, specPath, reason: 'local could not produce a green+clean test' };
}
