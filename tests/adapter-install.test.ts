import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect, majorOf, unitDeps, installReact } from '../src/adapters/react-vitest-playwright/install.js';
import { installVue } from '../src/adapters/vue-vitest-playwright/install.js';

describe('react install — pure helpers', () => {
  it('majorOf pulls the major out of a semver range', () => {
    expect(majorOf('^18.2.0')).toBe(18);
    expect(majorOf('17')).toBe(17);
    expect(majorOf(undefined)).toBeNull();
    expect(majorOf('nonsense')).toBeNull();
  });

  it('unitDeps version-matches testing-library to the React major', () => {
    expect(unitDeps(18).some((d) => d.startsWith('@testing-library/react@^16'))).toBe(true);
    expect(unitDeps(17).some((d) => d.startsWith('@testing-library/react@^12'))).toBe(true);
    const r16 = unitDeps(16);
    expect(r16.some((d) => d.startsWith('@testing-library/react@^11'))).toBe(true);
    expect(r16.some((d) => d.startsWith('@testing-library/user-event@^13'))).toBe(true);
    // base toolchain is always present regardless of version
    expect(unitDeps(18).some((d) => d.startsWith('vitest@'))).toBe(true);
  });

  it('inspect reads bundler + dev server from the package', () => {
    const vite = inspect({ dependencies: { react: '^18.0.0', vite: '^5.0.0' }, scripts: { dev: 'vite' } });
    expect(vite).toMatchObject({ reactMajor: 18, bundler: 'vite', devUrl: 'http://localhost:5173' });

    const cra = inspect({ dependencies: { react: '^17.0.0', 'react-scripts': '5.0.0' }, scripts: { start: 'react-scripts start' } });
    expect(cra).toMatchObject({ bundler: 'cra', devCmd: 'npm start', devUrl: 'http://localhost:3000' });

    const unknown = inspect({ dependencies: { react: '18' } });
    expect(unknown.bundler).toBe('unknown');
    expect(unknown.reactMajor).toBe(18);
  });
});

// End-to-end installers with the toolchain deps ALREADY present, so the npm-install
// step short-circuits before any shell call — leaving only the pure fs behaviour.
describe('installReact — config + script wiring (no shell)', () => {
  let dir: string;
  const pkg = (extra: object) => JSON.stringify({
    devDependencies: { react: '^18.2.0', vite: '^5.0.0', vitest: '^2.1.0', '@playwright/test': '^1.48.0' },
    scripts: { dev: 'vite' }, ...extra,
  });
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pv-install-react-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the .mts vitest config, setup, and a bundler-matched playwright config', async () => {
    writeFileSync(join(dir, 'package.json'), pkg({}));
    await installReact(dir);
    expect(existsSync(join(dir, 'vitest.config.mts'))).toBe(true);
    expect(existsSync(join(dir, 'vitest.setup.ts'))).toBe(true);
    const pw = readFileSync(join(dir, 'playwright.config.ts'), 'utf8');
    expect(pw).toContain('http://localhost:5173'); // vite dev server matched
    const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(written.scripts.test).toBe('vitest run');
    expect(written.scripts['test:e2e']).toBe('playwright test');
  });

  it('never clobbers a real existing test script', async () => {
    writeFileSync(join(dir, 'package.json'), pkg({ scripts: { dev: 'vite', test: 'jest --coverage' } }));
    await installReact(dir);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.test).toBe('jest --coverage');
  });
});

describe('installVue — config + script wiring (no shell)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pv-install-vue-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes vue configs and wires scripts when deps are already present', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      devDependencies: { vue: '^3.4.0', vitest: '^2.1.0', '@vue/test-utils': '^2.4.6' },
    }));
    await installVue(dir);
    expect(readFileSync(join(dir, 'vitest.config.ts'), 'utf8')).toContain('@vitejs/plugin-vue');
    expect(existsSync(join(dir, 'playwright.config.ts'))).toBe(true);
    const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(written.scripts.test).toBe('vitest run');
    expect(written.scripts['test:e2e']).toBe('playwright test');
  });
});
