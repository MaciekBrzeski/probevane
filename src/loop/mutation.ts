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
