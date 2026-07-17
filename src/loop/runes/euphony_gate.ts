import type { Rune } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectFunctions } from '../../quality/analyze.js';
import { analyzeNames } from '../../quality/euphony.js';

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

/** Collect function names from the run's edited (non-test) source files. */
async function editedFunctionNames(ctx: RunCtx): Promise<string[]> {
  const names: string[] = [];
  for (const rel of ctx.editedFiles) {
    if (!SOURCE.test(rel) || /\.(test|spec)\./.test(rel)) continue;
    const src = await readFile(join(ctx.workdir, rel), 'utf8').catch(() => '');
    for (const fn of detectFunctions(src)) if (fn.name.length >= 3) names.push(fn.name);
  }
  return names;
}

/** Advisory harvest: measure + log the euphony of the run's new function names. */
async function euphonyReport(ctx: RunCtx): Promise<void> {
  const names = await editedFunctionNames(ctx);
  if (names.length < 2) return;
  const r = analyzeNames(names);
  const fams = r.families.slice(0, 3).map((f) => f.names.join('/')).join(', ');
  const plural = r.families.length === 1 ? 'family' : 'families';
  const report =
    `♪ euphony ${r.score}/100 · ${r.families.length} rhyming ${plural}` +
    `${fams ? ` — ${fams}` : ''} · meter ${r.meterMean.toFixed(1)}±${r.meterStdev.toFixed(1)}`;
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
