import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { sh } from '../../util/exec.js';

// Hardened for real apps: match the project's React version (RTL major), read
// the dev command/port (Vite vs CRA), wire tsconfig path aliases + ignore CSS
// imports in vitest, and never clobber existing config.

interface ProjectInfo {
  reactMajor: number;
  bundler: 'vite' | 'cra' | 'unknown';
  devCmd: string;
  devUrl: string;
}

function inspect(pkg: any): ProjectInfo {
  const all = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  const reactMajor = majorOf(all.react) ?? 18;
  const scripts = pkg.scripts ?? {};
  let bundler: ProjectInfo['bundler'] = 'unknown';
  if (all.vite || /vite/.test(scripts.dev ?? '')) bundler = 'vite';
  else if (all['react-scripts'] || /react-scripts/.test(scripts.start ?? '')) bundler = 'cra';
  // dev command + port
  if (bundler === 'cra') return { reactMajor, bundler, devCmd: scripts.start ? 'npm start' : 'npm run dev', devUrl: 'http://localhost:3000' };
  return { reactMajor, bundler, devCmd: scripts.dev ? 'npm run dev' : 'npm start', devUrl: 'http://localhost:5173' };
}

function majorOf(range?: string): number | null {
  if (!range) return null;
  const m = range.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// React-version-matched testing-library + user-event (don't force a React upgrade).
function unitDeps(reactMajor: number): string[] {
  const base = ['vitest@^2.1.0', '@vitest/coverage-v8@^2.1.0', '@testing-library/jest-dom@^6.4.0', 'jsdom@^25.0.0', 'msw@^2.4.0', 'vite-tsconfig-paths@^5.0.0', '@vitejs/plugin-react@^4.3.0'];
  if (reactMajor >= 18) return [...base, '@testing-library/react@^16.0.0', '@testing-library/user-event@^14.5.0'];
  if (reactMajor === 17) return [...base, '@testing-library/react@^12.1.5', '@testing-library/user-event@^14.5.0'];
  return [...base, '@testing-library/react@^11.2.7', '@testing-library/user-event@^13.5.0'];
}

const VITEST_SETUP = `import '@testing-library/jest-dom/vitest';\n`;

function vitestConfig(): string {
  return `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

// Added by probevane. Hardened for real apps: tsconfig path aliases resolved,
// CSS/asset imports ignored (css:false) so component imports don't crash.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/main.{ts,tsx}', 'src/index.{ts,tsx}', 'src/**/*.d.ts'],
    },
  },
});
`;
}

function pwConfig(info: ProjectInfo): string {
  return `import { defineConfig } from '@playwright/test';

// Added by probevane. Dev server matched to the project (${info.bundler}).
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: '${info.devUrl}' },
  webServer: {
    command: '${info.devCmd}',
    url: '${info.devUrl}',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
`;
}

const exists = (p: string) => access(p).then(() => true).catch(() => false);

// Install the testing toolchain only when missing. --legacy-peer-deps: real apps
// pin old peers (React 17 etc) that would otherwise abort the install on peer-conflict.
async function installDeps(dir: string, all: Record<string, string>, info: ProjectInfo): Promise<void> {
  const missing: string[] = [];
  if (!all.vitest) missing.push(...unitDeps(info.reactMajor));
  if (!all['@playwright/test']) missing.push('@playwright/test@^1.48.0');
  if (!missing.length) return;
  const r = await sh(`npm install -D --legacy-peer-deps ${missing.join(' ')}`, dir, 300_000);
  if (!r.ok) throw new Error(`probevane: dep install failed\n${r.stderr.slice(-1500)}`);
}

// Wire the test scripts without clobbering a real existing one.
function ensureScripts(pkg: any): void {
  pkg.scripts = pkg.scripts || {};
  if (!pkg.scripts.test || /no test specified/.test(pkg.scripts.test)) pkg.scripts.test = 'vitest run';
  if (!pkg.scripts['test:e2e']) pkg.scripts['test:e2e'] = 'playwright test';
}

// Write the vitest config as .mts so it ALWAYS loads as ESM — vite-tsconfig-paths
// is ESM-only and a plain .ts config is treated as CJS in a non-module project
// (the esbuild "ESM file cannot be loaded by require" failure on real apps).
// Never clobber existing config files.
async function writeConfigs(dir: string, info: ProjectInfo): Promise<void> {
  const haveVitestCfg = (await exists(join(dir, 'vitest.config.ts'))) || (await exists(join(dir, 'vitest.config.mts')));
  if (!haveVitestCfg) await writeFile(join(dir, 'vitest.config.mts'), vitestConfig());
  if (!(await exists(join(dir, 'vitest.setup.ts')))) await writeFile(join(dir, 'vitest.setup.ts'), VITEST_SETUP);
  if (!(await exists(join(dir, 'playwright.config.ts')))) await writeFile(join(dir, 'playwright.config.ts'), pwConfig(info));
}

export async function installReact(dir: string): Promise<void> {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const all = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  const info = inspect(pkg);

  await installDeps(dir, all, info);

  ensureScripts(pkg);
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  await writeConfigs(dir, info);
}
