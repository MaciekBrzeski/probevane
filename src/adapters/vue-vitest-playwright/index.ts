import { readPackageDeps } from '../pkg-deps.js';
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
import { manifestFields } from '../../vane/adapter-manifest.js';
import { vueAuditRules } from '../../audit/rules-vue.js';

// vue-vitest-playwright — third stack. Implements the SAME StackAdapter
// contract; reuses the loop, mock maker, audit core, library and eval unchanged.
export const vueAdapter: StackAdapter = {
  id: 'vue-vitest-playwright',

  async detect(dir: string): Promise<number> {
    const deps = await readPackageDeps(dir);
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

  // DATA fields (guidance/patternsDoc/commands) come from the vane manifest;
  // TS fallbacks stay so a missing manifest fails loud, never silently degrades.
  // auditRules stays TS — a clean 1-liner, no gain from a registry ref.
  guidance(_kind: TestKind): string {
    return '';
  },

  patternsDoc(_kind: TestKind): Promise<string> {
    return Promise.resolve('');
  },

  auditRules(): AuditRule[] {
    return vueAuditRules();
  },

  commands(): AdapterCommands {
    return { typecheck: '', lint: '', testUnit: '', testE2e: '', coverage: '' };
  },

  ...manifestFields('vue-vitest-playwright'),
};
