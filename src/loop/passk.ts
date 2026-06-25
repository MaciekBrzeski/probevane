import { cp, rm, readdir, copyFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { StackAdapter, TestKind } from '../adapters/adapter.js';
import { auditFiles } from '../audit/core.js';

// pass@k generation + verify — the fourier-nca pattern: a weak model's single
// shot is unreliable, so sample K candidate suites, SCORE each, and keep the
// best. Selection is deterministic (this file); only the K generations need a
// model. Beats one-shot for exactly the kind of model we default to.

export interface SuiteScore {
  green: boolean;
  tests: number;
  coverage: number;
  auditScore: number;
  auditErrors: number;
  /** Composite quality used to rank candidates. Higher is better. */
  value: number;
}

export async function scoreSuite(dir: string, adapter: StackAdapter): Promise<SuiteScore> {
  const run = await adapter.run(dir, 'unit');
  const cov = await adapter.coverage(dir).catch(() => null);
  const specs = await adapter.specFiles(dir);
  const audit = await auditFiles(specs.map((s) => join(dir, s)), adapter.auditRules());
  const coverage = cov?.ok ? cov.statements : 0;
  // Reward green + coverage + count + clean audit; a red or audit-broken suite is worthless.
  const value = !run.green || audit.errors > 0 ? -1 : coverage + run.passed * 2 + audit.score * 5;
  return { green: run.green, tests: run.passed, coverage, auditScore: audit.score, auditErrors: audit.errors, value };
}

export interface Candidate<T = unknown> {
  label: string;
  score: SuiteScore;
  ref: T;
}

/** Pick the highest-value candidate (deterministic; ties → first). */
export function selectBest<T>(candidates: Candidate<T>[]): Candidate<T> | null {
  let best: Candidate<T> | null = null;
  for (const c of candidates) if (!best || c.score.value > best.score.value) best = c;
  return best && best.score.value >= 0 ? best : null;
}

// --- orchestration (needs a model for the K generations) -------------------

export interface PassKOptions {
  dir: string;
  kind: TestKind;
  adapter: StackAdapter;
  k: number;
  /** Generate a candidate suite INTO `candidateDir` (writes spec files there). */
  generate: (candidateDir: string) => Promise<boolean>; // returns accepted
  log?: (l: string) => void;
}

/** Run K generations into isolated copies, score each, copy the best specs back. */
export async function passKGenerate(opts: PassKOptions): Promise<{ best: Candidate<string> | null; all: Candidate<string>[] }> {
  const log = opts.log ?? (() => {});
  const all: Candidate<string>[] = [];
  for (let i = 0; i < opts.k; i++) {
    const cand = `${opts.dir}.passk-${i}`;
    await rm(cand, { recursive: true, force: true }).catch(() => {});
    await cp(opts.dir, cand, { recursive: true, filter: (p) => !p.includes('node_modules') });
    // share installed deps
    const { symlink } = await import('node:fs/promises');
    await symlink(join(opts.dir, 'node_modules'), join(cand, 'node_modules')).catch(() => {});
    const accepted = await opts.generate(cand).catch(() => false);
    const score = await scoreSuite(cand, opts.adapter).catch(() => ({ green: false, tests: 0, coverage: 0, auditScore: 0, auditErrors: 1, value: -1 } as SuiteScore));
    log(`[passk] candidate ${i}: accepted=${accepted} value=${score.value} (tests=${score.tests} cov=${score.coverage}%)`);
    all.push({ label: `k${i}`, score, ref: cand });
  }
  const best = selectBest(all);
  if (best) {
    // copy the winning spec files back into the real dir
    for (const spec of await opts.adapter.specFiles(best.ref)) {
      const dst = join(opts.dir, spec);
      await mkdir(dirname(dst), { recursive: true }).catch(() => {});
      await copyFile(join(best.ref, spec), dst).catch(() => {});
    }
    log(`[passk] selected ${best.label} (value=${best.score.value})`);
  }
  for (const c of all) await rm(c.ref, { recursive: true, force: true }).catch(() => {});
  return { best, all };
}

export { readdir };
