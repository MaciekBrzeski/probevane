import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';

// hermetic_gate — a test must be hermetic: no real network, no real clock/random.
// Non-hermetic tests are flaky and let a model "pass" by hitting a live backend
// instead of asserting behavior. This also enforces that synthesized mocks are
// actually used (see the mock maker). Scans the spec files written this run.
// Test/spec files across stacks — the gate scopes to the ones THIS run edited.
const TEST_RE = /(\.(test|spec)\.[tj]sx?$)|(test_\w+\.py$)|(_test\.py$)|(_test\.go$)|(tests\/.*\.rs$)/;
const EXTERNAL_URL = /["'`]https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/;
const RAW_NET = /\b(fetch|axios|XMLHttpRequest|got|superagent)\s*[(.]/;
const MOCK_SETUP = /\b(setupServer|server\.use|http\.(get|post|put|patch|delete)|graphql\.|vi\.mock|page\.route|mockFetch|msw)\b/;
const REAL_TIME = /\b(Date\.now\s*\(|new Date\s*\(\s*\)|Math\.random\s*\()/;
const TIME_CONTROL = /\b(useFakeTimers|setSystemTime|vi\.setSystemTime|seed|mockReturnValue|spyOn\s*\(\s*Math)/;

/** Single shared rune instance — stateless, so one const serves every profile. */
export const hermeticGate: Rune = {
  name: 'hermetic_gate',

  /** The hermeticity rule, stated up front so specs mock network/time from the start. */
  systemPromptAddition(): string {
    return 'HERMETIC: tests must not hit a real network or real clock/random. Route all network through the provided mocks (MSW handlers / vi.mock / page.route), and control time/random with fake timers or seeds. A test that calls fetch/axios directly or uses Date.now()/Math.random() unmocked is rejected.';
  },

  /** Block finishing while any spec THIS run wrote breaks a hermeticity rule. */
  async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
    // Scope to the spec files THIS run wrote — not the whole suite. A pre-existing
    // unrelated test holding a URL/clock literal must not block a run (and
    // no_regression forbids "fixing" it, which would deadlock). Mirrors audit/
    // no_regression scoping.
    const specs = [...ctx.editedFiles].filter((rel) => TEST_RE.test(rel));
    for (const rel of specs) {
      const src = await readFile(join(ctx.workdir, rel), 'utf8').catch(() => '');
      if (!src) continue;

      if (EXTERNAL_URL.test(src)) {
        return block(
          `hermetic_gate: external URL in ${rel}`,
          `${rel} references an external http(s) URL — tests must not hit a real backend. Use a mock (MSW handler / page.route) instead.`,
        );
      }
      if (RAW_NET.test(src) && !MOCK_SETUP.test(src)) {
        return block(
          `hermetic_gate: un-mocked network in ${rel}`,
          `${rel} calls the network (fetch/axios/...) without any mock setup. Wire it through MSW / vi.mock / page.route so the test is deterministic.`,
        );
      }
      if (REAL_TIME.test(src) && !TIME_CONTROL.test(src)) {
        return block(
          `hermetic_gate: uncontrolled time/random in ${rel}`,
          `${rel} uses Date.now()/new Date()/Math.random() without fake timers or a seed — this makes the test non-deterministic. Control it (vi.useFakeTimers / vi.setSystemTime / a seeded value).`,
        );
      }
    }
    return ALLOW;
  },
};
