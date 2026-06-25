import type {
  StackAdapter,
  TestKind,
  TestTarget,
  ProbeResult,
  RunScope,
  AdapterCommands,
  AuditRule,
} from '../adapter.js';
import { detectReact } from './detect.js';
import { installReact } from './install.js';
import { discoverReact } from './discover.js';
import { runReact, coverageReact } from './run.js';
import { probeReactUnit, probeReactE2e } from './probe.js';
import { jsAuditRules } from '../../audit/rules-js.js';
import { findSpecFiles } from '../../util/specfiles.js';
import { loadPrompt } from '../../library/prompt.js';

// react-vitest-playwright — the first-class adapter.
// P0: detect / install / discover / run / coverage / auditRules / commands.
// probe + unitGen + e2eGen are filled in P2 (unit) and P3 (e2e).
export const reactAdapter: StackAdapter = {
  id: 'react-vitest-playwright',

  detect: detectReact,
  install: installReact,
  discover: (dir: string, kind: TestKind) => discoverReact(dir, kind),
  run: (dir: string, scope: RunScope, files?: string[]) => runReact(dir, scope, files),
  coverage: (dir: string) => coverageReact(dir),

  async probe(dir: string, target: TestTarget): Promise<ProbeResult> {
    return target.kind === 'unit' ? probeReactUnit(dir, target) : probeReactE2e(dir, target);
  },

  specFiles(dir: string): Promise<string[]> {
    return findSpecFiles(dir); // *.{test,spec}.{ts,tsx,js,jsx}
  },

  guidance(kind: TestKind): string {
    return kind === 'unit'
      ? `(vitest + @testing-library/react) placed next to their source under src/ as src/<Name>.test.tsx. Cover happy paths, edge cases, and immutability for pure functions; user-visible behavior for components. PREFER pure functions / hooks / slices — they need the least setup. If a component requires context (Redux store, React Router, a Theme/Context provider), wrap it in the app's REAL providers via a render helper, e.g. render(<Provider store={makeStore()}><MemoryRouter>{ui}</MemoryRouter></Provider>) — import the app's store/router from its modules; do not reimplement them. Mock only the network. CSS/asset imports are ignored by the config, so don't worry about them.`
      : `(Playwright @playwright/test) placed under the e2e/ directory as e2e/<name>.spec.ts. ALWAYS \`import { test, expect } from '@playwright/test'\` — NEVER the bare 'playwright/test' (it collects 0 tests → "No tests found"). The app runs at the base URL; use page.goto('/') then drive it via getByRole/getByLabel using ONLY the labels/roles/buttons in the ground truth. Assert user-visible outcomes.`;
  },

  patternsDoc(kind: TestKind): Promise<string> {
    return loadPrompt(kind === 'unit' ? 'unit-patterns.md' : 'e2e-patterns.md');
  },

  auditRules(): AuditRule[] {
    return jsAuditRules();
  },

  commands(): AdapterCommands {
    return {
      typecheck: 'npx tsc --noEmit',
      lint: 'true', // most fixtures have no linter; adapter stays green-by-default
      testUnit: 'npx vitest run',
      testE2e: 'npx playwright test',
      coverage: 'npx vitest run --coverage --coverage.reporter=json-summary',
    };
  },
};
