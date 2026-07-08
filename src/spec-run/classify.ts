import { SPEC_PATHS, type RunSpec, type SpecPath } from './runspec.js';

// Turn a simple NL prompt into a DRAFT RunSpec plus the short list of questions a
// human (or a policy file) must answer before the run goes dark. Deterministic
// keyword core — no LLM required — so the intake is $0 and testable; an LLM
// classifier can refine `draft` upstream, but this is the floor and the fallback.
// Mirrors the shape of ado.parseDirective, but never requires the prompt to embed
// literal flags.

export interface Question {
  field: 'path' | 'ship' | 'takeover' | 'scope';
  ask: string;
  options: string[];
  def: string; // default answer (used in non-interactive / policy mode)
}

export type DraftSpec = Partial<RunSpec> & { path: SpecPath };

export interface Classification {
  draft: DraftSpec;
  confidence: number; // 0..1 for the inferred path
  questions: Question[];
}

// Path keyword table, checked in priority order — test/fix intent beats the generic
// "add/build" verbs so "add tests for X" routes to write_tests, not feature.
const PATH_RULES: { path: SpecPath; re: RegExp }[] = [
  { path: 'write_tests', re: /\b(test|tests|testing|coverage|spec|specs|e2e|unit)\b/ },
  { path: 'fix', re: /\b(fix|repair|bug|broken|failing|regression|make .*green)\b/ },
  { path: 'refactor', re: /\b(refactor|clean ?up|simplify|tidy|restructure|rename|extract)\b/ },
  { path: 'migrate', re: /\b(migrate|migration|upgrade|port to)\b/ },
  { path: 'document', re: /\b(document|docs|documentation|comment|jsdoc)\b/ },
  { path: 'feature', re: /\b(feature|implement|build|create|support|add)\b/ },
];

const FILE_RE = /([\w./-]+\.(?:tsx?|jsx?|mjs|py|vue|svelte|go|rs))/;

/** Infer the task path from a prompt + a confidence (how unambiguous the match). */
export function classifyPath(prompt: string): { path: SpecPath; confidence: number } {
  const lower = prompt.toLowerCase();
  const hits = PATH_RULES.filter((r) => r.re.test(lower));
  if (hits.length === 0) return { path: 'write_tests', confidence: 0.3 }; // fall back to the factory's home turf
  // First rule wins (priority order); confidence drops when several categories match.
  const confidence = hits.length === 1 ? 0.9 : Math.max(0.4, 0.9 - 0.2 * (hits.length - 1));
  return { path: hits[0].path, confidence };
}

/** Classify a prompt into a draft spec + the questions worth asking. */
export function classifyPrompt(prompt: string): Classification {
  const { path, confidence } = classifyPath(prompt);
  const lower = prompt.toLowerCase();
  const kind: RunSpec['kind'] = /\b(e2e|end.to.end|playwright|browser)\b/.test(lower) ? 'e2e' : 'unit';
  const file = prompt.match(FILE_RE)?.[1];

  const draft: DraftSpec = { path, kind };
  if (file) {
    draft.only = file; // a named file → scoped single-target run, no decomposition
    draft.decompose = { perFile: false };
  }
  if (path !== 'write_tests') draft.task = prompt.trim();

  const questions: Question[] = [];
  if (confidence < 0.7)
    questions.push({ field: 'path', ask: `Which task path fits "${prompt}"?`, options: [...SPEC_PATHS], def: path });
  if (!file)
    questions.push({ field: 'scope', ask: 'Run over the whole repo (decompose per file) or one target?', options: ['repo', 'one'], def: 'repo' });
  // Safety-critical: opening PRs is off unless explicitly confirmed.
  questions.push({ field: 'ship', ask: 'Open a PR on each accepted unit?', options: ['no', 'yes'], def: 'no' });
  return { draft, confidence, questions };
}

const DEFAULTS = { kind: 'unit', budget: 40000, maxSteps: 30, minTests: 3, minCoverage: 80 } as const;

/** Resolve a draft + answers + a base identity into a validated-shape RunSpec.
 *  `answers` is keyed by Question.field (interactive round OR a policy file). */
export function resolveSpec(
  base: { id: string; dir: string; prompt: string; model?: string; takeover?: string; strict?: boolean },
  draft: DraftSpec,
  answers: Record<string, string> = {},
): RunSpec {
  const path = (answers.path as SpecPath) ?? draft.path;
  const perFile = answers.scope ? answers.scope === 'repo' : draft.decompose?.perFile ?? path === 'write_tests';
  const ship = answers.ship === 'yes';
  // Bare ollama takes over with itself (complexity.ts) — surface an explicit rescue tier when given.
  const takeover = answers.takeover && answers.takeover !== 'none' ? answers.takeover : base.takeover;

  const spec: RunSpec = {
    id: base.id,
    prompt: base.prompt,
    path,
    dir: base.dir,
    kind: draft.kind ?? DEFAULTS.kind,
    acceptance:
      path === 'write_tests' ? { minTests: DEFAULTS.minTests, minCoverage: DEFAULTS.minCoverage } : {},
    budget: DEFAULTS.budget,
    maxSteps: DEFAULTS.maxSteps,
    strict: base.strict ?? false,
    worktree: false, // dark runs edit the live tree; ship branches instead of worktree (which discards)
    ship,
    decompose: { perFile },
  };
  if (base.model) spec.model = base.model;
  if (takeover) spec.takeover = takeover;
  if (draft.only) spec.only = draft.only;
  if (draft.task ?? (path !== 'write_tests' ? base.prompt : undefined)) spec.task = draft.task ?? base.prompt;
  if (draft.targetGaps) spec.targetGaps = true;
  return spec;
}
