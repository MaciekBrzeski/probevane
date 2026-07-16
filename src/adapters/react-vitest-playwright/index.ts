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
import { manifestFields } from '../../vane/adapter-manifest.js';

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
    return jsAuditRules();
  },

  commands(): AdapterCommands {
    return { typecheck: '', lint: '', testUnit: '', testE2e: '', coverage: '' };
  },

  ...manifestFields('react-vitest-playwright'),
};
