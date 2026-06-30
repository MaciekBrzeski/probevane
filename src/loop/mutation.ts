import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { StackAdapter } from '../adapters/adapter.js';

// Shared mutation tester — mutate a few source operators and check the suite
// fails (kills the mutant). Used by mutation_gate (enforce) and bench (report).
export const MUTATIONS: [RegExp, string][] = [
  [/===/g, '!=='],
  [/!==/g, '==='],
  [/>=/g, '<'],
  [/<=/g, '>'],
  [/&&/g, '||'],
  [/\btrue\b/g, 'false'],
  [/\+/g, '-'],
];

export interface MutationResult {
  total: number;
  killed: number;
  score: number; // killed/total (1 if none applicable)
}

/** A mutant the current suite does NOT catch — the actionable signal for
 *  mutation-driven generation: write a test that fails when this is applied. */
export interface SurvivingMutant {
  sourcePath: string;
  line: number;
  mutation: string; // "=== → !=="
  snippet: string; // the source line, trimmed
}

/** 1-based line number of a character index in `src`. */
export function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length;
}

/** Shared context for evaluating one mutation against one target file. */
interface MutantCtx {
  dir: string;
  adapter: StackAdapter;
  abs: string;
  original: string;
  sourcePath: string;
}

/** Build the per-target mutation context; null when the source can't be read. */
async function targetCtx(dir: string, adapter: StackAdapter, sourcePath: string): Promise<MutantCtx | null> {
  const abs = join(dir, sourcePath);
  const original = await readFile(abs, 'utf8').catch(() => '');
  if (!original) return null;
  return { dir, adapter, abs, original, sourcePath };
}

/** Apply one mutation; return the surviving mutant (suite stayed GREEN) or null. */
async function trySurvivor(c: MutantCtx, re: RegExp, repl: string): Promise<SurvivingMutant | null> {
  re.lastIndex = 0;
  const m = re.exec(c.original);
  if (!m) return null;
  const mutated = c.original.slice(0, m.index) + repl + c.original.slice(m.index + m[0].length);
  if (mutated === c.original) return null;
  try {
    await writeFile(c.abs, mutated);
    const run = await c.adapter.run(c.dir, 'unit');
    if (!run.green) return null;
    const line = lineOf(c.original, m.index);
    return { sourcePath: c.sourcePath, line, mutation: `${m[0]} → ${repl}`, snippet: (c.original.split('\n')[line - 1] ?? '').trim().slice(0, 90) };
  } finally {
    await writeFile(c.abs, c.original);
  }
}

/** Mutation-driven steering: apply one mutation at a time; a mutant that leaves
 *  the suite GREEN survived — collect it with its location. */
export async function survivingMutants(dir: string, adapter: StackAdapter, maxMutants = 6, maxTargets = 3): Promise<SurvivingMutant[]> {
  const out: SurvivingMutant[] = [];
  const targets = (await adapter.discover(dir, 'unit')).slice(0, maxTargets);
  for (const t of targets) {
    const ctx = await targetCtx(dir, adapter, t.sourcePath);
    if (!ctx) continue;
    for (const [re, repl] of MUTATIONS) {
      if (out.length >= maxMutants) break;
      const s = await trySurvivor(ctx, re, repl);
      if (s) out.push(s);
    }
  }
  return out;
}

/** Prompt block steering generation at the surviving mutants. */
export function mutantDigest(survivors: SurvivingMutant[]): string {
  if (!survivors.length) return '';
  return (
    'SURVIVING MUTANTS — the current tests do NOT catch these. Add a test that FAILS when each mutation is applied (assert the exact behavior the mutation breaks):\n' +
    survivors.map((m) => `- ${m.sourcePath}:${m.line}  \`${m.mutation}\`  in: ${m.snippet}`).join('\n')
  );
}

/** Apply one mutation; null = not applicable, true = killed (suite went red), false = survived. */
async function scoreMutant(c: MutantCtx, re: RegExp, repl: string): Promise<boolean | null> {
  if (!re.test(c.original)) return null;
  const mutated = c.original.replace(re, repl);
  if (mutated === c.original) return null;
  try {
    await writeFile(c.abs, mutated);
    const run = await c.adapter.run(c.dir, 'unit');
    return !run.green; // killed if the suite went red
  } finally {
    await writeFile(c.abs, c.original);
  }
}

export async function mutationScore(dir: string, adapter: StackAdapter, maxMutants = 5, maxTargets = 3): Promise<MutationResult> {
  const targets = (await adapter.discover(dir, 'unit')).slice(0, maxTargets);
  let total = 0;
  let killed = 0;
  for (const t of targets) {
    const ctx = await targetCtx(dir, adapter, t.sourcePath);
    if (!ctx) continue;
    for (const [re, repl] of MUTATIONS) {
      if (total >= maxMutants) break;
      const result = await scoreMutant(ctx, re, repl);
      if (result === null) continue;
      total++;
      if (result) killed++;
    }
  }
  return { total, killed, score: total ? killed / total : 1 };
}
