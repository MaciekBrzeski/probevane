import { basename } from 'node:path';
import { brainFor, isDirectModel } from '../../brain/select.js';
import { routeModels } from '../complexity.js';
import { runLoop, type RunOutcome } from '../engine/index.js';
import { nullAdapter } from '../../adapters/null-adapter.js';
import { buildDocsDigest } from '../digest.js';
import { planFirst } from '../runes/plan_first.js';
import { sessionDiary } from '../runes/session_diary.js';
import { caveatHarvest } from '../runes/caveat_harvest.js';
import {
  docsContextInject, docsScopeGuard, docStructureGate, docReferenceGate, docsAcceptance,
} from '../runes/docs.js';

// Narrative documentation loop — stack-agnostic (no adapter, no tests). Grounds a
// docs-writer model on a project digest and gates the output on structure +
// reference-integrity (cited paths must exist) before accepting.

export interface DocsRunOpts {
  dir: string;
  outPath: string; // project-relative markdown path to write
  sections: string[];
  model?: string;
  maxSteps?: number;
  budget?: number;
  log?: (line: string) => void;
}

export async function runDocs(opts: DocsRunOpts): Promise<RunOutcome> {
  const log = opts.log ?? (() => {});
  const digest = buildDocsDigest(opts.dir);
  // Resolve the model the same way run-path does (pass local:/openai: through,
  // otherwise route — handles 'auto', 'bridge', haiku/sonnet/opus).
  const route = routeModels(opts.model ?? 'auto', false);
  const brain = brainFor(isDirectModel(opts.model) ? opts.model : route.primary);
  log(`[probevane] docs model=${brain.model} dir=${opts.dir} -> ${opts.outPath}`);

  const task = [
    `Documentation task: write a comprehensive guide for this project to ${opts.outPath}.`,
    `Required sections: ${opts.sections.join(', ')}.`,
    `Read the real source files to ground your writing. Cite only paths that exist. Be thorough and accurate.`,
  ].join('\n');

  return runLoop({
    workdir: opts.dir,
    adapter: nullAdapter,
    brain,
    runes: [
      docsContextInject(digest, opts.sections, opts.outPath),
      docsScopeGuard(),
      planFirst,
      docStructureGate(opts.outPath, opts.sections),
      docReferenceGate(opts.outPath, log),
      docsAcceptance(opts.outPath),
      sessionDiary,
      caveatHarvest,
    ],
    task,
    label: `docs:${basename(opts.dir)}`,
    maxSteps: opts.maxSteps ?? 24,
    budget: opts.budget,
    log,
  });
}
