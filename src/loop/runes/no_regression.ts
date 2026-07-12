import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { ToolCall } from '../types.js';

// no_regression — protect PRE-EXISTING tests. When adding tests we must not
// edit or delete the project's existing specs (that would mask a regression or
// silently weaken coverage). We snapshot the set of spec files that existed at
// run start; any write/edit/delete targeting one of them is blocked. The full
// suite staying green is already enforced by validation_gate, so together they
// guarantee: existing tests are untouched AND still pass.
export function noRegression(): Rune {
  const preexisting = new Set<string>();

  return {
    name: 'no_regression',

    async prepare(ctx: RunCtx): Promise<string | undefined> {
      for (const f of await ctx.adapter.specFiles(ctx.workdir)) preexisting.add(norm(f));
      return preexisting.size
        ? `NO REGRESSION: do not modify or delete the project's existing test files (${[...preexisting].join(', ')}). Add NEW test files only.`
        : undefined;
    },

    async beforeToolCall(call: ToolCall, _ctx: RunCtx): Promise<RuneDecision> {
      if (call.name !== 'edit_file' && call.name !== 'write_file' && call.name !== 'delete_file') return ALLOW;
      const path = norm(String((call.input as any).path ?? ''));
      if (preexisting.has(path)) {
        return block(
          `no_regression: attempt to modify pre-existing test ${path}`,
          `${path} existed before this run. Do not change or delete existing tests — create a new spec file instead.`,
        );
      }
      return ALLOW;
    },
  };
}

/** Normalize a tool path for set membership (strip a leading ./). */
function norm(p: string): string {
  return p.replace(/^\.\//, '');
}
