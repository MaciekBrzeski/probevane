import { readFile, readdir, writeFile, access } from 'node:fs/promises';
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
import { runSvelte, coverageSvelte } from './run.js';
import { findSpecFiles } from '../../util/specfiles.js';
import { manifestFields } from '../../vane/adapter-manifest.js';
import { jsAuditRules } from '../../audit/rules-js.js';
import { astExtract } from '../ast-probe.js';
import { readPackageDeps } from '../pkg-deps.js';

const exists = (p: string) => access(p).then(() => true).catch(() => false);
const DEPS = [
  'vitest@^2.1.0', '@vitest/coverage-v8@^2.1.0', '@testing-library/svelte@^5.2.0',
  '@testing-library/jest-dom@^6.4.0', '@sveltejs/vite-plugin-svelte@^3.1.0', 'jsdom@^25.0.0', 'msw@^2.4.0',
];
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,js}'],
    coverage: { provider: 'v8', include: ['src/**/*.{ts,svelte}'], exclude: ['src/**/*.{test,spec}.ts', 'src/main.ts'] } },
});
`;

// svelte-vitest — Svelte stack (vitest + @testing-library/svelte). Same contract;
// reuses loop/mock/audit/eval unchanged.
export const svelteAdapter: StackAdapter = {
  id: 'svelte-vitest',

  async detect(dir: string): Promise<number> {
    const deps = await readPackageDeps(dir);
    let score = 0;
    if (deps.svelte) score += 0.6;
    if (deps['@sveltejs/vite-plugin-svelte'] || deps['@sveltejs/kit']) score += 0.3;
    return Math.min(score, 1);
  },

  async install(dir: string): Promise<void> {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!all.vitest || !all['@testing-library/svelte']) {
      const r = await sh(`npm install -D --legacy-peer-deps ${DEPS.join(' ')}`, dir, 300_000);
      if (!r.ok) throw new Error(`probevane: dep install failed\n${r.stderr.slice(-1500)}`);
    }
    pkg.scripts = pkg.scripts || {};
    if (!pkg.scripts.test || /no test specified/.test(pkg.scripts.test)) pkg.scripts.test = 'vitest run';
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    if (!(await exists(join(dir, 'vitest.config.ts'))) && !(await exists(join(dir, 'vitest.config.mts'))))
      await writeFile(join(dir, 'vitest.config.mts'), VITEST_CONFIG);
    if (!(await exists(join(dir, 'vitest.setup.ts')))) await writeFile(join(dir, 'vitest.setup.ts'), "import '@testing-library/jest-dom/vitest';\n");
  },

  async discover(dir: string, _kind: TestKind): Promise<TestTarget[]> {
    const files = await walk(join(dir, 'src')).catch(() => []);
    return files
      .filter((f) => /\.(svelte|ts)$/.test(f) && !/\.(test|spec|d)\.ts$/.test(f) && !/main\.ts$/.test(f))
      .map((f) => ({ kind: 'unit', sourcePath: relative(dir, f), name: f.split('/').pop()!.replace(/\.(svelte|ts)$/, '') }));
  },

  async probe(dir: string, target: TestTarget): Promise<ProbeResult> {
    const src = await readFile(join(dir, target.sourcePath), 'utf8').catch(() => '');
    const isSvelte = target.sourcePath.endsWith('.svelte');
    const lines = [`GROUND TRUTH for ${target.sourcePath}:`];
    if (isSvelte) {
      const props = [...src.matchAll(/export\s+let\s+(\w+)(?:\s*:\s*([^=;]+))?/g)].map((m) => `${m[1]}${m[2] ? ': ' + m[2].trim() : ''}`);
      if (props.length) lines.push(`- props (export let): ${props.join(', ')}`);
      const aria = [...src.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
      if (aria.length) lines.push(`- aria-labels: ${[...new Set(aria)].join(', ')}`);
      lines.push('- render with `render(Component, { props })` from @testing-library/svelte; query by role/label; fireEvent.click then await tick or use findBy*.');
    } else {
      const ast = astExtract(src, target.sourcePath);
      const fns = ast ? ast.exports.map((e) => e.signature ?? e.name) : [];
      if (fns.length) lines.push(`- exported functions: ${fns.join('; ')}`);
    }
    const ok = lines.length > 1;
    return { target, facts: { isSvelte }, digest: lines.join('\n'), ok, error: ok ? undefined : 'nothing testable' };
  },

  run: (dir: string, scope: RunScope, files?: string[]) => runSvelte(dir, scope, files),
  coverage: (dir: string) => coverageSvelte(dir),
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
    return jsAuditRules();
  },
  commands(): AdapterCommands {
    return { typecheck: '', lint: '', testUnit: '', testE2e: '', coverage: '' };
  },

  ...manifestFields('svelte-vitest'),
};

// Recursive file listing, skipping build/VCS dirs.
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(e.name)) continue;
      out.push(...(await walk(join(dir, e.name))));
    } else out.push(join(dir, e.name));
  }
  return out;
}
