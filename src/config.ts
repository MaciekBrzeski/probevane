import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Per-project config: probevane.config.{ts,js,mjs,json} in the target dir.
// Precedence (resolved by the CLI): flag > config > built-in default.

export interface ProbevaneConfig {
  model?: string; // auto | haiku | sonnet | opus | <id> | local:<id>
  kind?: 'unit' | 'e2e';
  minTests?: number;
  minCoverage?: number;
  maxTargets?: number;
  maxSteps?: number;
  mock?: boolean;
  mutation?: boolean;
  flakeGuard?: boolean;
  a11y?: boolean;
  visual?: boolean;
  quality?: boolean; // opt-in source-quality gate on edited files (refactor/feature/fix/repair)
  mfe?: boolean; // opt-in micro-frontend (Module Federation) standards gate
  takeover?: string;
  budget?: number; // hard output-token ceiling per run
}

const NAMES = ['probevane.config.ts', 'probevane.config.js', 'probevane.config.mjs', 'probevane.config.json'];

// The known config keys + their expected primitive type — drives validation so a
// typo (`maxStep`) or wrong type (`minTests: "5"`) is a clear error, not silently
// ignored. Keep in sync with ProbevaneConfig.
const SCHEMA: Record<keyof ProbevaneConfig, 'string' | 'number' | 'boolean'> = {
  model: 'string', kind: 'string', minTests: 'number', minCoverage: 'number',
  maxTargets: 'number', maxSteps: 'number', mock: 'boolean', mutation: 'boolean',
  flakeGuard: 'boolean', a11y: 'boolean', visual: 'boolean', quality: 'boolean',
  mfe: 'boolean', takeover: 'string', budget: 'number',
};

/** Validate a single config entry; returns an error string or null. */
function checkEntry(k: string, v: unknown): string | null {
  const expected = SCHEMA[k as keyof ProbevaneConfig];
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
