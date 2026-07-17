import type { Rune } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { detectFunctions } from '../../quality/analyze.js';
import { analyzeByFile } from '../../quality/euphony.js';

// euphony_gate (opt-in, ADVISORY) — a novel rune that reads the run's new
// function names for prosody. It nudges the model (preamble) to name sibling
// functions so they rhyme or share a syllabic meter, then on stop it MEASURES
// the euphony of what was written and logs a report. It never blocks — naming
// music is a tie-breaker, not an acceptance condition (probevane's honest-gate
// rule: no false blocks). See src/quality/euphony.ts for the phonetic model.

const EUPHONY_SYSTEM_PROMPT =
  'EUPHONY (advisory): when you add or rename functions, prefer names whose head word ' +
  'rhymes with a sibling in the same file, or shares its syllabic meter — let a module ' +
  'read with a little music (detect/collect, render/gender, parse/sparse). Never sacrifice ' +
  'clarity or accuracy for a rhyme; euphony breaks ties, it is not a rule.';

const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;

/** Collect function names per edited (non-test) source file. */
async function editedFunctionsByFile(ctx: RunCtx): Promise<Map<string, string[]>> {
  const byFile = new Map<string, string[]>();
  for (const rel of ctx.editedFiles) {
    if (!SOURCE.test(rel) || /\.(test|spec)\./.test(rel)) continue;
    const src = await readFile(join(ctx.workdir, rel), 'utf8').catch(() => '');
    const names = detectFunctions(src).map((fn) => fn.name).filter((n) => n.length >= 3);
    if (names.length) byFile.set(rel, names);
  }
  return byFile;
}

/** Advisory harvest: measure + log the euphony of the run's new function names,
 *  overall + naming the most-musical file (per-file scoring). */
async function euphonyReport(ctx: RunCtx): Promise<void> {
  const byFile = await editedFunctionsByFile(ctx);
  const { files, overall } = analyzeByFile(byFile);
  if (overall.count < 2) return;
  const fams = overall.families.slice(0, 3).map((f) => f.names.join('/')).join(', ');
  const plural = overall.families.length === 1 ? 'family' : 'families';
  const best = files.length > 1 && files[0].report.count >= 2
    ? ` · best ${basename(files[0].file)} ${files[0].report.score}` : '';
  const report =
    `♪ euphony ${overall.score}/100 · ${overall.families.length} rhyming ${plural}` +
    `${fams ? ` — ${fams}` : ''} · meter ${overall.meterMean.toFixed(1)}±${overall.meterStdev.toFixed(1)}${best}`;
  console.log(`[euphony] ${report}`); // CLI log
  ctx.notes.push(report); // surfaced as a `note` event for the UI
}

/** Build the euphony rune — a preamble naming nudge + an on-stop euphony report
 *  over the run's new function names. Advisory only; it never blocks a finish. */
export function euphonyGate(): Rune {
  return {
    name: 'euphony_gate',
    systemPromptAddition: () => EUPHONY_SYSTEM_PROMPT,
    onStop: (ctx) => euphonyReport(ctx),
  };
}
