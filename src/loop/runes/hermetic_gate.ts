import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Rune, RuneDecision } from '../rune.js';
import { ALLOW, block } from '../rune.js';
import type { RunCtx } from '../ctx.js';

// hermetic_gate — a test must be hermetic: no real network, no real clock/random.
// Non-hermetic tests are flaky and let a model "pass" by hitting a live backend
// instead of asserting behavior. This also enforces that synthesized mocks are
// actually used (see the mock maker). Scans the spec files written this run.
const EXTERNAL_URL = /["'`]https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/;
const RAW_NET = /\b(fetch|axios|XMLHttpRequest|got|superagent)\s*[(.]/;
const MOCK_SETUP = /\b(setupServer|server\.use|http\.(get|post|put|patch|delete)|graphql\.|vi\.mock|page\.route|mockFetch|msw)\b/;
const REAL_TIME = /\b(Date\.now\s*\(|new Date\s*\(\s*\)|Math\.random\s*\()/;
const TIME_CONTROL = /\b(useFakeTimers|setSystemTime|vi\.setSystemTime|seed|mockReturnValue|spyOn\s*\(\s*Math)/;

export const hermeticGate: Rune = {
  name: 'hermetic_gate',

  systemPromptAddition(): string {
    return 'HERMETIC: tests must not hit a real network or real clock/random. Route all network through the provided mocks (MSW handlers / vi.mock / page.route), and control time/random with fake timers or seeds. A test that calls fetch/axios directly or uses Date.now()/Math.random() unmocked is rejected.';
  },

  async shouldStop(ctx: RunCtx): Promise<RuneDecision> {
    const specs = await ctx.adapter.specFiles(ctx.workdir);
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
