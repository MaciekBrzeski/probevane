import type { Rune } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import { loadPrompt } from '../../library/prompt.js';
import { retrieveFewShot } from '../../library/retrieve.js';
import { recentCaveats } from '../../library/caveats.js';

// context_inject — RAG/few-shot. Ported from runestone's context_inject rune.
// prepare() assembles, once per run: the quality rules + the kind-specific
// pattern library + up to K worked examples from the cross-project learning
// library (filtered by stack + kind so React few-shot never leaks into Python).
export function contextInject(kind: 'unit' | 'e2e'): Rune {
  return {
    name: 'context_inject',

    async prepare(ctx: RunCtx): Promise<string | undefined> {
      const parts: string[] = [];

      const quality = await loadPrompt('test-generation-prompt.md');
      if (quality) parts.push(quality);

      const patterns = await ctx.adapter.patternsDoc(kind);
      if (patterns) parts.push(patterns);

      // Deterministic mode (record/replay eval): skip mutable cross-run state
      // (caveats + learning-library few-shot) so the prompt — and thus the
      // cassette request hash — is stable. Static quality+patterns stay.
      const deterministic = process.env.PROBEVANE_DETERMINISTIC === '1';

      const caveats = deterministic ? [] : await recentCaveats(8).catch(() => []);
      if (caveats.length)
        parts.push(`CAVEATS from past runs (avoid these gate failures):\n${caveats.join('\n')}`);

      const examples = deterministic ? [] : await retrieveFewShot({ stack: ctx.adapter.id, kind, topK: 3 }).catch(() => []);
      if (examples.length) {
        const blocks = examples
          .map((e, i) => `### Example ${i + 1} — ${e.meta.category} (score ${e.meta.score ?? '?'})\n${e.body}`)
          .join('\n\n');
        parts.push(`WORKED EXAMPLES from the learning library (match this quality bar):\n\n${blocks}`);
      }

      return parts.length ? parts.join('\n\n---\n\n') : undefined;
    },
  };
}
