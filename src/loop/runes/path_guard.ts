import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { ToolCall } from '../types.js';
import { WRITE_TOOLS } from '../tools.js';

// path_guard — ported from runestone's path_guard rune. tools.ts already blocks
// absolute paths and `..` escapes, but dependency/build dirs live INSIDE the
// project, so a stalled model could (and did) start editing node_modules. This
// denies writes/deletes to anything outside the test-writing surface.
//
// Hard-won: without this, a model stuck on a typecheck failure "fixed" tsc by
// overwriting node_modules/.bin/tsc. The loop builds what the gates allow.
const DENY = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)(dist|build|coverage)\//,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
];

/** Single shared rune instance — stateless, so one const serves every profile. */
export const pathGuard: Rune = {
  name: 'path_guard',

  /** The write-scope rule, stated up front so the model stays in bounds. */
  systemPromptAddition(): string {
    return 'SCOPE: only create/edit test files under the project source (e.g. src/, tests/, e2e/). Never edit node_modules, build output, lockfiles, or tooling — if a tool seems broken, report it, do not modify it.';
  },

  /** Veto any write/delete into the deny-list (deps / build output / lockfiles). */
  async beforeToolCall(call: ToolCall, _ctx: RunCtx): Promise<RuneDecision> {
    if (!WRITE_TOOLS.has(call.name) && call.name !== 'delete_file') return ALLOW;
    const path = String((call.input as any).path ?? '');
    if (DENY.some((re) => re.test(path))) {
      return block(
        `path_guard: write outside scope (${path})`,
        `${path} is outside the test-writing scope (node_modules / build / lockfiles / tooling are off-limits). Only write test files under the project source.`,
      );
    }
    return ALLOW;
  },
};
