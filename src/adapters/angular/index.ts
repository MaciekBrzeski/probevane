import { readFile, readdir, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  StackAdapter, TestKind, TestTarget, ProbeResult, RunScope, RunResult, CoverageResult, AdapterCommands, AuditRule,
} from '../adapter.js';
import { sh } from '../../util/exec.js';
import { jsAuditRules } from '../../audit/rules-js.js';
import { astExtract } from '../ast-probe.js';
import { loadPrompt } from '../../library/prompt.js';

// angular — Angular stack via jest-preset-angular (no browser, CI-friendly).
// Tests use TestBed + jest. Same StackAdapter contract as the others.
const exists = (p: string) => access(p).then(() => true).catch(() => false);
const REPORT = '.probevane-jest.json';

export const angularAdapter: StackAdapter = {
  id: 'angular',

  async detect(dir: string): Promise<number> {
    let pkg: any;
    try { pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); } catch { return 0; }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return deps['@angular/core'] ? 0.9 : 0;
  },

  async install(dir: string): Promise<void> {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!all['jest-preset-angular']) {
      // jest-preset-angular 17 needs the jsdom env (unbundled since Jest 28).
      const r = await sh('npm install -D --legacy-peer-deps jest jest-preset-angular jest-environment-jsdom @types/jest', dir, 600_000);
      if (!r.ok) throw new Error(`probevane: angular test-dep install failed\n${r.stderr.slice(-1500)}`);
    }
    const { writeFile } = await import('node:fs/promises');
    if (!(await exists(join(dir, 'jest.config.js'))) && !(await exists(join(dir, 'jest.config.ts')))) {
      // v17 config: createCjsPreset + the zone setup-env (the old setup-jest path was removed).
      await writeFile(join(dir, 'jest.config.js'),
        `const { createCjsPreset } = require('jest-preset-angular/presets');\nmodule.exports = { ...createCjsPreset(), setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'], testMatch: ['**/*.spec.ts'] };\n`);
      await writeFile(join(dir, 'setup-jest.ts'), `import 'jest-preset-angular/setup-env/zone';\n`);
    }
    if (!(await exists(join(dir, 'tsconfig.spec.json')))) {
      await writeFile(join(dir, 'tsconfig.spec.json'),
        `{ "extends": "./tsconfig.json", "compilerOptions": { "types": ["jest", "node"] }, "include": ["src/**/*.spec.ts", "src/**/*.ts"] }\n`);
    }
  },

  async discover(dir: string, _kind: TestKind): Promise<TestTarget[]> {
    const files = (await walk(join(dir, 'src')).catch(() => [])) as string[];
    return files
      .filter((f) => /\.ts$/.test(f) && !/\.(spec|module|d)\.ts$/.test(f) && !/(^|\/)(main|polyfills)\.ts$/.test(f))
      .map((f) => ({ kind: 'unit', sourcePath: relative(dir, f), name: f.split('/').pop()!.replace(/\.ts$/, '') }));
  },

  async probe(dir: string, target: TestTarget): Promise<ProbeResult> {
    const src = await readFile(join(dir, target.sourcePath), 'utf8').catch(() => '');
    const ast = astExtract(src, target.sourcePath);
    const isComponent = /@Component\b/.test(src);
    const isService = /@Injectable\b/.test(src);
    const cls = src.match(/export\s+class\s+(\w+)/)?.[1];
    const lines = [`GROUND TRUTH for ${target.sourcePath}:`];
    if (cls) lines.push(`- class: ${cls}${isComponent ? ' (component)' : isService ? ' (service)' : ''}`);
    if (ast?.exports.length) lines.push(`- exports: ${ast.exports.map((e) => e.signature ?? e.name).join('; ')}`);
    lines.push(isComponent
      ? '- TestBed.configureTestingModule({declarations:[Cmp]}); createComponent; assert via fixture.componentInstance + fixture.nativeElement (getByRole-style queries).'
      : '- import the class; for a service use TestBed.inject or `new`; assert real return values + error paths.');
    const ok = !!cls;
    return { target, facts: { cls, isComponent, isService }, digest: lines.join('\n'), ok, error: ok ? undefined : 'no exported class' };
  },

  async run(dir: string, _scope: RunScope, files?: string[]): Promise<RunResult> {
    const scoped = files?.length ? ' ' + files.map((f) => JSON.stringify(f)).join(' ') : '';
    const r = await sh(`npx jest --json --outputFile=${REPORT} --testLocationInResults${scoped}`, dir, 300_000);
    let passed = 0, failed = 0, skipped = 0;
    try {
      const j = JSON.parse(await readFile(join(dir, REPORT), 'utf8'));
      passed = j.numPassedTests ?? 0; failed = j.numFailedTests ?? 0; skipped = j.numPendingTests ?? 0;
    } catch { failed = r.ok ? 0 : Math.max(failed, 1); }
    return { passed, failed, skipped, green: r.ok && failed === 0 && passed > 0, raw: (r.stdout + r.stderr).slice(-4000) };
  },

  async coverage(dir: string): Promise<CoverageResult> {
    await sh('npx jest --coverage --coverageReporters=json-summary', dir, 300_000).catch(() => null);
    try {
      const j = JSON.parse(await readFile(join(dir, 'coverage', 'coverage-summary.json'), 'utf8'));
      const t = j.total;
      return { statements: t.statements.pct, branches: t.branches.pct, functions: t.functions.pct, lines: t.lines.pct, ok: true };
    } catch { return { statements: 0, branches: 0, functions: 0, lines: 0, ok: false }; }
  },

  async specFiles(dir: string): Promise<string[]> {
    const files = (await walk(join(dir, 'src')).catch(() => [])) as string[];
    return files.filter((f) => /\.spec\.ts$/.test(f)).map((f) => relative(dir, f));
  },

  guidance(_kind: TestKind): string {
    return `(Angular + jest-preset-angular) place the test next to its source as <name>.spec.ts. Use TestBed for components/services. \`import { describe, it, expect } from '@jest/globals'\` is implicit; assert concrete values + error paths. Use ONLY the class/exports in the ground truth.`;
  },
  patternsDoc(_kind: TestKind): Promise<string> { return loadPrompt('angular-unit-patterns.md'); },
  auditRules(): AuditRule[] { return jsAuditRules(); },
  commands(): AdapterCommands {
    return { typecheck: 'npx tsc --noEmit', lint: 'true', testUnit: 'npx jest', testE2e: 'true', coverage: 'npx jest --coverage' };
  },
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) { if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue; out.push(...(await walk(join(dir, e.name)))); }
    else out.push(join(dir, e.name));
  }
  return out;
}
