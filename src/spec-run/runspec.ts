import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { statePath } from '../util/state.js';
import { LAUNCH_OPS, type LaunchPlan } from '../observe/launch.js';

// RunSpec — the first-class, persisted specification a dark-factory run executes.
// A superset of the per-project ProbevaneConfig plus the argv-only knobs (path,
// task, only, worktree, acceptance). Produced by intake (NL prompt → draft +
// question round), decomposed by expand(), then serialized to an argv tuple the
// existing enqueue / supervisor / path-CLI already understand. One shape, two
// fill-modes (interactive answers OR a policy file), one consumer.

export const SPEC_PATHS = ['write_tests', 'feature', 'refactor', 'repair', 'fix', 'migrate', 'document'] as const;
/** One of SPEC_PATHS — the task path a spec routes to. */
export type SpecPath = (typeof SPEC_PATHS)[number];

// Which CLI op each path dispatches to (write_tests → generate; the rest are 1:1).
export const PATH_OP: Record<SpecPath, string> = {
  write_tests: 'generate', feature: 'feature', refactor: 'refactor',
  repair: 'repair', fix: 'fix', migrate: 'migrate', document: 'document',
};

/** Accept floors for a dark run — intake defaults fill them for write_tests;
 *  the task paths leave them empty. */
export interface Acceptance {
  minTests?: number;
  minCoverage?: number;
  /** Arbitrary exit-0 assertions. Persisted for the record; NOT forwarded through
   *  the supervisor (validateLaunch rejects shell metachars) — minTests/minCoverage
   *  are the floors enforced on a dark run. */
  shellChecks?: string[];
}

/** The frozen run specification — built by intake/resolveSpec, persisted under
 *  <state>/specs/, executed via specToLaunchPlan. */
export interface RunSpec {
  id: string;
  prompt: string; // the original NL prompt this spec was distilled from
  path: SpecPath;
  dir: string;
  task?: string; // free-text task for feature/refactor/repair/fix/migrate/document
  kind: 'unit' | 'e2e';
  only?: string; // single-file scope (the decomposition primitive)
  targetGaps?: boolean;
  acceptance: Acceptance;
  model?: string;
  takeover?: string; // genuinely-stronger rescue tier (bare ollama takes over with itself)
  budget?: number;
  maxSteps?: number;
  strict?: boolean;
  worktree?: boolean;
  ship?: boolean;
  decompose?: { perFile: boolean };
}

// Optional scalar fields + their expected type (only checked when present).
const OPTIONAL_TYPES: [string, 'string' | 'number'][] = [
  ['budget', 'number'], ['maxSteps', 'number'], ['model', 'string'], ['task', 'string'],
];

/** Validate a RunSpec — required fields + enum + types. Returns error strings. */
export function validateRunSpec(spec: unknown): string[] {
  if (!spec || typeof spec !== 'object') return ['spec must be an object'];
  const s = spec as Record<string, unknown>;
  const errs: string[] = [];
  const req = (ok: boolean, msg: string) => void (ok || errs.push(msg));
  req(typeof s.id === 'string' && !!s.id, '"id" must be a string');
  req(typeof s.prompt === 'string', '"prompt" must be a string');
  req(SPEC_PATHS.includes(s.path as SpecPath), `"path" must be one of: ${SPEC_PATHS.join(', ')}`);
  req(typeof s.dir === 'string' && !!s.dir, '"dir" must be a string');
  req(s.kind === 'unit' || s.kind === 'e2e', '"kind" must be "unit" or "e2e"');
  req(typeof s.acceptance === 'object' && s.acceptance !== null, '"acceptance" must be an object');
  for (const [k, want] of OPTIONAL_TYPES) req(s[k] === undefined || typeof s[k] === want, `"${k}" must be ${want}`);
  return errs;
}

// Emit `name <value>` only when the value is set — keeps the argv free of "undefined".
const numFlag = (flags: string[], name: string, v?: number) => {
  if (v !== undefined) flags.push(name, String(v));
};

/** Serialize a RunSpec to a LaunchPlan {op, dir, flags[]} — the argv the enqueue
 *  path + supervisor consume. write_tests → `generate` with scope/floor flags; the
 *  task paths carry `--task`. shellChecks are intentionally NOT emitted (see type). */
export function specToLaunchPlan(spec: RunSpec): LaunchPlan {
  const op = PATH_OP[spec.path];
  const flags: string[] = [];
  if (op === 'generate') {
    flags.push('--kind', spec.kind);
    if (spec.only) flags.push('--only', spec.only, '--max-targets', '1');
    if (spec.targetGaps) flags.push('--target-gaps');
    numFlag(flags, '--min-tests', spec.acceptance.minTests);
    numFlag(flags, '--min-coverage', spec.acceptance.minCoverage);
  } else if (spec.task) {
    flags.push('--task', spec.task);
  }
  if (spec.model) flags.push('--model', spec.model);
  if (spec.takeover) flags.push('--takeover', spec.takeover);
  numFlag(flags, '--budget', spec.budget);
  numFlag(flags, '--max-steps', spec.maxSteps);
  if (spec.strict) flags.push('--strict');
  if (spec.worktree) flags.push('--worktree');
  return { op: op as LaunchPlan['op'], dir: resolve(spec.dir), flags };
}

/** True when the spec's path dispatches to a supervisor-runnable op. */
export function isDarkRunnable(spec: RunSpec): boolean {
  return (LAUNCH_OPS as readonly string[]).includes(PATH_OP[spec.path]);
}

/** Full argv for a direct CLI run (`bin/probevane <op> <dir> ...flags`). */
export function specToArgv(spec: RunSpec): string[] {
  const p = specToLaunchPlan(spec);
  return [p.op, p.dir, ...p.flags];
}

export const specsDir = (root?: string) => (root ? resolve(root, 'specs') : statePath('specs'));

/** Persist a frozen spec to <state>/specs/<id>.json. */
export async function saveSpec(spec: RunSpec, root?: string): Promise<string> {
  const dir = specsDir(root);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${spec.id}.json`);
  await writeFile(path, JSON.stringify(spec, null, 2));
  return path;
}

/** Load a persisted spec by id. */
export async function loadSpec(id: string, root?: string): Promise<RunSpec> {
  const path = resolve(specsDir(root), `${id}.json`);
  const spec = JSON.parse(await readFile(path, 'utf8')) as RunSpec;
  const errs = validateRunSpec(spec);
  if (errs.length) throw new Error(`invalid spec ${id}: ${errs.join('; ')}`);
  return spec;
}
