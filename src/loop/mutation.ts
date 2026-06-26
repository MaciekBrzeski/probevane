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

/** Mutation-driven steering: apply one mutation at a time; a mutant that leaves
 *  the suite GREEN survived — collect it with its location. */
export async function survivingMutants(dir: string, adapter: StackAdapter, maxMutants = 6, maxTargets = 3): Promise<SurvivingMutant[]> {
  const out: SurvivingMutant[] = [];
  const targets = (await adapter.discover(dir, 'unit')).slice(0, maxTargets);
  for (const t of targets) {
    const abs = join(dir, t.sourcePath);
    const original = await readFile(abs, 'utf8').catch(() => '');
    if (!original) continue;
    for (const [re, repl] of MUTATIONS) {
      if (out.length >= maxMutants) break;
      re.lastIndex = 0;
      const m = re.exec(original);
      if (!m) continue;
      const mutated = original.slice(0, m.index) + repl + original.slice(m.index + m[0].length);
      if (mutated === original) continue;
      try {
        await writeFile(abs, mutated);
        const run = await adapter.run(dir, 'unit');
        if (run.green) {
          const line = lineOf(original, m.index);
          out.push({ sourcePath: t.sourcePath, line, mutation: `${m[0]} → ${repl}`, snippet: (original.split('\n')[line - 1] ?? '').trim().slice(0, 90) });
        }
      } finally {
        await writeFile(abs, original);
      }
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

export async function mutationScore(dir: string, adapter: StackAdapter, maxMutants = 5, maxTargets = 3): Promise<MutationResult> {
  const targets = (await adapter.discover(dir, 'unit')).slice(0, maxTargets);
  let total = 0;
  let killed = 0;
  for (const t of targets) {
    const abs = join(dir, t.sourcePath);
    const original = await readFile(abs, 'utf8').catch(() => '');
    if (!original) continue;
    for (const [re, repl] of MUTATIONS) {
      if (total >= maxMutants) break;
      if (!re.test(original)) continue;
      const mutated = original.replace(re, repl);
      if (mutated === original) continue;
      total++;
      try {
        await writeFile(abs, mutated);
        const run = await adapter.run(dir, 'unit');
        if (!run.green) killed++;
      } finally {
        await writeFile(abs, original);
      }
    }
  }
  return { total, killed, score: total ? killed / total : 1 };
}
