import { readFile, writeFile, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  StackAdapter,
  TestKind,
  TestTarget,
  ProbeResult,
  RunScope,
  AdapterCommands,
  AuditRule,
} from '../adapter.js';
import { sh } from '../../util/exec.js';
import { runVitest, coverageVitest } from '../vitest-runner.js';
import { findSpecFiles } from '../../util/specfiles.js';
import { loadPrompt } from '../../library/prompt.js';
import { jsAuditRules } from '../../audit/rules-js.js';
import { astExtract } from '../ast-probe.js';
import { readPackageDeps } from '../pkg-deps.js';
import { walkFiles } from '../walk.js';

// node-vitest — generic TS/JS library stack (vitest, no UI framework). Lets
// probevane test plain Node libraries — including ITSELF. Detect scores below
// the framework adapters so a React/Vue/Svelte app still picks its own.
const exists = (p: string) => access(p).then(() => true).catch(() => false);

export const nodeAdapter: StackAdapter = {
  id: 'node-vitest',

  async detect(dir: string): Promise<number> {
    const deps = await readPackageDeps(dir);
    if (deps.react || deps.vue || deps.svelte || deps['@angular/core']) return 0; // a framework adapter owns it
    let score = 0;
    if (deps.vitest) score += 0.4;
    if (deps.typescript) score += 0.1;
    return Math.min(score, 0.5);
  },

  async install(dir: string): Promise<void> {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!all.vitest) {
      const r = await sh('npm install -D --legacy-peer-deps vitest@^2.1.0 @vitest/coverage-v8@^2.1.0', dir, 300_000);
      if (!r.ok) throw new Error(`probevane: dep install failed\n${r.stderr.slice(-1500)}`);
    }
    // ensure a vitest config that includes BOTH src and tests specs
    if (!(await exists(join(dir, 'vitest.config.ts'))) && !(await exists(join(dir, 'vitest.config.mts')))) {
      await writeFile(
        join(dir, 'vitest.config.mts'),
        `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
  coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/**/*.{test,spec}.ts'] },
} });
`,
      );
    }
  },

  async discover(dir: string, _kind: TestKind): Promise<TestTarget[]> {
    const files = (await walkFiles(join(dir, 'src')).catch(() => [])) as string[];
    return files
      .filter((f) => /\.[tj]s$/.test(f) && !/\.(test|spec|d)\.[tj]s$/.test(f) && !/(^|\/)(index|main)\.[tj]s$/.test(f))
      .map((f) => ({ kind: 'unit', sourcePath: relative(dir, f), name: f.split('/').pop()!.replace(/\.[tj]s$/, '') }));
  },

  async probe(dir: string, target: TestTarget): Promise<ProbeResult> {
    const src = await readFile(join(dir, target.sourcePath), 'utf8').catch(() => '');
    const ast = astExtract(src, target.sourcePath);
    const fns = ast ? ast.exports.map((e) => e.signature ?? e.name) : [];
    const importPath = './' + target.name;
    const lines = [`GROUND TRUTH for ${target.sourcePath} (import from "${importPath}"):`];
    if (fns.length) lines.push(`- exported functions: ${fns.join('; ')}`);
    lines.push('- pure vitest unit test; `import { describe, it, expect } from "vitest"` explicitly; import the function and assert real values.');
    const ok = fns.length > 0;
    return { target, facts: { fns }, digest: lines.join('\n'), ok, error: ok ? undefined : 'no exported functions' };
  },

  run: (dir: string, _scope: RunScope, files?: string[]) => runVitest(dir, files),
  coverage: (dir: string) => coverageVitest(dir),
  specFiles: (dir: string) => findSpecFiles(dir),

  guidance(_kind: TestKind): string {
    return `(vitest, plain TS) place the test next to its source as src/<name>.test.ts. ALWAYS \`import { describe, it, expect } from 'vitest'\` (no globals). Import the exported functions and assert concrete values; cover happy paths, edge cases, and error paths. No DOM, no framework. Use only the ground-truth exports.`;
  },
  patternsDoc(_kind: TestKind): Promise<string> {
    return loadPrompt('node-unit-patterns.md');
  },
  auditRules(): AuditRule[] {
    return jsAuditRules();
  },
  commands(): AdapterCommands {
    return { typecheck: 'npx tsc --noEmit', lint: 'true', testUnit: 'npx vitest run', testE2e: 'true', coverage: 'npx vitest run --coverage --coverage.reporter=json-summary' };
  },
};
