import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { newSpecs } from './validation_gate.js';
import { scoreAssertions, aggregateScore } from '../../audit/assertion-score.js';

// assertion_gate (opt-in) — feed the assertion-quality score BACK into the loop.
// `assert-score` grades a suite standalone, but the model never saw it; this gate
// scores the specs the run wrote and blocks (with the weak assertions named) when
// the grade is below `min`, so the loop strengthens them instead of shipping
// toBeDefined/snapshot-only/tautology tests. Opt in with --assert-min N.
export function assertionGate(min: number): Rune {
  return {
    name: 'assertion_gate',

    systemPromptAddition(): string {
      return `ASSERTION QUALITY (enforced, min ${min}/100): assert concrete VALUES — avoid toBeDefined/toBeTruthy, snapshot-only tests, bare not.toThrow(), and tautologies (expect(1).toBe(1)). Pin real expected output.`;
    },

    async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
      const specs = newSpecs(ctx);
      if (!specs.length) return ALLOW;
      const perFile = await Promise.all(
        specs.map(async (f) => ({ file: f, s: scoreAssertions(await readFile(join(ctx.workdir, f), 'utf8').catch(() => '')) })),
      );
      const agg = aggregateScore(perFile);
      if (agg.total === 0 || agg.score >= min) return ALLOW;
      const weak = perFile
        .flatMap((p) => p.s.weak.map((w) => `${p.file}:${w.line} ${w.kind} — ${w.snippet.trim().slice(0, 60)}`))
        .slice(0, 8);
      return block(
        `assertion_gate: assertion quality ${agg.score}/100 < ${min} (${agg.weak} weak of ${agg.total})`,
        `Strengthen these weak assertions (assert concrete values):\n${weak.join('\n')}`,
      );
    },
  };
}
