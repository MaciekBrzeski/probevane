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

export async function loadConfig(dir: string): Promise<ProbevaneConfig> {
  for (const name of NAMES) {
    const file = join(dir, name);
    if (!(await access(file).then(() => true).catch(() => false))) continue;
    try {
      if (name.endsWith('.json')) return JSON.parse(await readFile(file, 'utf8')) as ProbevaneConfig;
      const mod = await import(pathToFileURL(file).href);
      return (mod.default ?? mod.config ?? mod) as ProbevaneConfig;
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
