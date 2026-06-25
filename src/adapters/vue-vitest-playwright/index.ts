import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  StackAdapter,
  TestKind,
  TestTarget,
  ProbeResult,
  RunScope,
  AdapterCommands,
  AuditRule,
} from '../adapter.js';
import { installVue } from './install.js';
import { probeVueUnit, discoverVue } from './probe.js';
import { runVue, coverageVue } from './run.js';
import { findSpecFiles } from '../../util/specfiles.js';
import { loadPrompt } from '../../library/prompt.js';
import { vueAuditRules } from '../../audit/rules-vue.js';

// vue-vitest-playwright — third stack. Implements the SAME StackAdapter
// contract; reuses the loop, mock maker, audit core, library and eval unchanged.
export const vueAdapter: StackAdapter = {
  id: 'vue-vitest-playwright',

  async detect(dir: string): Promise<number> {
    let pkg: any;
    try {
      pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    } catch {
      return 0;
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    let score = 0;
    if (deps.vue) score += 0.6;
    if (deps['@vitejs/plugin-vue'] || deps['vue-tsc']) score += 0.3;
    return Math.min(score, 1);
  },

  install: installVue,
  discover: (dir: string, kind: TestKind) => discoverVue(dir, kind),
  probe: (dir: string, target: TestTarget): Promise<ProbeResult> => probeVueUnit(dir, target),
  run: (dir: string, scope: RunScope, files?: string[]) => runVue(dir, scope, files),
  coverage: (dir: string) => coverageVue(dir),
  specFiles: (dir: string) => findSpecFiles(dir),

  guidance(kind: TestKind): string {
    return kind === 'unit'
      ? `(vitest + @vue/test-utils) placed next to source as src/<Name>.test.ts. Mount components with mount(Comp, { props }); query with wrapper.get('[aria-label="…"]'); ALWAYS await wrapper.get(...).trigger('click') before asserting. Test pure .ts helpers directly.`
      : `(Playwright @playwright/test) under e2e/<name>.spec.ts; page.goto('/') then drive via getByLabel/getByRole using ONLY the labels in the ground truth.`;
  },

  patternsDoc(kind: TestKind): Promise<string> {
    return loadPrompt(kind === 'unit' ? 'vue-unit-patterns.md' : 'vue-e2e-patterns.md');
  },

  auditRules(): AuditRule[] {
    return vueAuditRules();
  },

  commands(): AdapterCommands {
    return {
      typecheck: 'true', // vue-tsc is finicky; validation relies on the green suite
      lint: 'true',
      testUnit: 'npx vitest run',
      testE2e: 'npx playwright test',
      coverage: 'npx vitest run --coverage --coverage.reporter=json-summary',
    };
  },
};
