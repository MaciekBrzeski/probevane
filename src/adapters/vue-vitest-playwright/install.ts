import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { sh } from '../../util/exec.js';

const DEPS = [
  'vitest@^2.1.0',
  '@vitest/coverage-v8@^2.1.0',
  '@vue/test-utils@^2.4.6',
  '@vitejs/plugin-vue@^5.1.0',
  'jsdom@^25.0.0',
  'msw@^2.4.0',
  '@playwright/test@^1.48.0',
];

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: { provider: 'v8', include: ['src/**/*.{ts,vue}'], exclude: ['src/**/*.{test,spec}.ts', 'src/main.ts'] },
  },
});
`;

const PW_CONFIG = `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
`;

const exists = (p: string) => access(p).then(() => true).catch(() => false);

export async function installVue(dir: string): Promise<void> {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const all = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  if (!all.vitest || !all['@vue/test-utils']) {
    const r = await sh(`npm install -D ${DEPS.join(' ')}`, dir, 300_000);
    if (!r.ok) throw new Error(`probevane: dep install failed\n${r.stderr.slice(-1500)}`);
  }
  pkg.scripts = pkg.scripts || {};
  if (!pkg.scripts.test || /no test specified/.test(pkg.scripts.test)) pkg.scripts.test = 'vitest run';
  if (!pkg.scripts['test:e2e']) pkg.scripts['test:e2e'] = 'playwright test';
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  if (!(await exists(join(dir, 'vitest.config.ts')))) await writeFile(join(dir, 'vitest.config.ts'), VITEST_CONFIG);
  if (!(await exists(join(dir, 'playwright.config.ts')))) await writeFile(join(dir, 'playwright.config.ts'), PW_CONFIG);
}
