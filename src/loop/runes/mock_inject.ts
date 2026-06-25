import type { Rune } from '../rune.js';
import type { RunCtx } from '../ctx.js';
import type { MockPlan } from '../../mock/index.js';

// mock_inject — hand the model the synthesized mock boundary: which network
// endpoints are stubbed (via the generated MSW handlers), which dependency
// modules to vi.mock, and prop fixtures. Paired with hermetic_gate, which
// rejects any test that bypasses these and hits the real network/clock.
export function mockInject(plan: MockPlan): Rune {
  return {
    name: 'mock_inject',

    async prepare(_ctx: RunCtx): Promise<string | undefined> {
      if (!plan.handlers.length && !plan.bundles.some((b) => b.depMocks.length || b.props)) return undefined;
      return [
        'MOCKS ARE PROVIDED — use them; do not call the real network or clock.',
        'The MSW server is ALREADY STARTED GLOBALLY (vitest.setup.ts) with handlers from',
        '`src/mocks/handlers.ts`, and unhandled requests THROW. So in a spec you do NOT set up',
        'server lifecycle yourself. For async UI/data, await it (findBy* / waitFor), e.g.',
        '`expect(await screen.findByText(...)).toBeInTheDocument()`. To change a response for one',
        'test, `import { server } from "../mocks/server"` and `server.use(http.get(...))`. To force an',
        'error path, override with an error response. For dependency modules listed below you may',
        'instead `vi.mock` them returning a fixture. For e2e, intercept with `page.route`.',
        '',
        plan.digest,
      ].join('\n');
    },
  };
}
