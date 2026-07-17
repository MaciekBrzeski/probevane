import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Per-project config: probevane.config.{ts,js,mjs,json} in the target dir.
// Precedence (resolved by the CLI): flag > config > built-in default.

export interface ProbevaneConfig {
  model?: string; // auto | haiku | sonnet | opus | <id> | local:<id> | ollama[:<id>] (ollama cloud, kimi-k2.7-code default)
  kind?: 'unit' | 'e2e';
  minTests?: number;
  minCoverage?: number;
  maxTargets?: number;
  maxSteps?: number;
  mock?: boolean;
  mutation?: boolean;
  strict?: boolean; // correctness floor: enforce mutation gate + mutation-target steering
  flakeGuard?: boolean;
  a11y?: boolean;
  visual?: boolean;
  quality?: boolean; // opt-in source-quality gate on edited files (refactor/feature/fix/repair)
  mfe?: boolean; // opt-in micro-frontend (Module Federation) standards gate
  structure?: boolean; // opt-in pyramid-structure gate (block NEW cross-dir layering violations)
  euphony?: boolean; // opt-in euphony rune (advisory): nudge + score function-name rhyme/meter
  takeover?: string;
  budget?: number; // hard output-token ceiling per run
  arch?: ArchRoles; // declared pyramid-model roles for `arch --pyramid` (flags override)
}

/** Declared pyramid-model roles for `arch --pyramid` — authored in the target repo's config. */
export interface ArchRoles {
  glue?: string[]; // connection-layer dirs (composition root, wiring, I/O)
  shared?: string[]; // common-base dirs every pyramid may import
  feature?: string[]; // pinned pyramids — beat the coupling heuristic
  maxFiles?: number; // crowding threshold: dirs with more direct files get split suggestions (default 15)
}

const NAMES = ['probevane.config.ts', 'probevane.config.js', 'probevane.config.mjs', 'probevane.config.json'];

// The known config keys + their expected primitive type — drives validation so a
// typo (`maxStep`) or wrong type (`minTests: "5"`) is a clear error, not silently
// ignored. Keep in sync with ProbevaneConfig.
const SCHEMA: Record<Exclude<keyof ProbevaneConfig, 'arch'>, 'string' | 'number' | 'boolean'> = {
  model: 'string', kind: 'string', minTests: 'number', minCoverage: 'number',
  maxTargets: 'number', maxSteps: 'number', mock: 'boolean', mutation: 'boolean',
  strict: 'boolean', flakeGuard: 'boolean', a11y: 'boolean', visual: 'boolean', quality: 'boolean',
  mfe: 'boolean', structure: 'boolean', euphony: 'boolean', takeover: 'string', budget: 'number',
};

const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Validate the nested `arch` block: glue/shared/feature string[] + maxFiles number. */
/** Validate one `arch.<key>` entry; returns an error message or null. */
function checkArchKey(key: string, val: unknown): string | null {
  if (key === 'maxFiles') return typeof val === 'number' ? null : '"arch.maxFiles" must be number';
  if (key !== 'glue' && key !== 'shared' && key !== 'feature') return `unknown key "arch.${key}"`;
  return isStringArray(val) ? null : `"arch.${key}" must be string[]`;
}

/** Validate the `arch` config block (object of glue/shared/feature/maxFiles); error or null. */
function checkArch(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '"arch" must be an object ({ glue?, shared?, feature?, maxFiles? })';
  for (const [k, val] of Object.entries(v)) {
    const err = checkArchKey(k, val);
    if (err) return err;
  }
  return null;
}

/** Validate a single config entry; returns an error string or null. */
function checkEntry(k: string, v: unknown): string | null {
  if (k === 'arch') return checkArch(v);
  const expected = SCHEMA[k as Exclude<keyof ProbevaneConfig, 'arch'>];
  if (!expected) return `unknown key "${k}"`;
  if (typeof v !== expected) return `"${k}" must be ${expected} (got ${typeof v})`;
  if (k === 'kind' && v !== 'unit' && v !== 'e2e') return `"kind" must be "unit" or "e2e"`;
  return null;
}

/** Validate a loaded config — unknown keys + wrong types. Returns error strings. */
export function validateConfig(cfg: unknown): string[] {
  if (!cfg || typeof cfg !== 'object') return ['config must be an object'];
  const errs: string[] = [];
  for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) {
    const err = checkEntry(k, v);
    if (err) errs.push(err);
  }
  return errs;
}

// Load + validate the first probevane.config.* found in `dir`; issues warn, never block.
export async function loadConfig(dir: string): Promise<ProbevaneConfig> {
  for (const name of NAMES) {
    const file = join(dir, name);
    if (!(await access(file).then(() => true).catch(() => false))) continue;
    try {
      let cfg: ProbevaneConfig;
      if (name.endsWith('.json')) cfg = JSON.parse(await readFile(file, 'utf8')) as ProbevaneConfig;
      else {
        const mod = await import(pathToFileURL(file).href);
        cfg = (mod.default ?? mod.config ?? mod) as ProbevaneConfig;
      }
      const errs = validateConfig(cfg);
      if (errs.length) console.error(`[probevane] config (${name}) issues:\n- ${errs.join('\n- ')}`);
      return cfg as ProbevaneConfig;
    } catch (e) {
      throw new Error(`probevane: failed to load ${name}: ${e}`);
    }
  }
  return {};
}

/** First defined value, in precedence order. */
export function pick<T>(...vals: (T | undefined)[]): T | undefined {
  for (const v of vals) if (v !== undefined) return v;
  return undefined;
}
