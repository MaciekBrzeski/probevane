import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkToolchain,
  checkCoverageBlindspots,
  checkPkgManifest,
  checkTrackedArtifacts,
  checkCiSwallow,
  checkStaleCassettes,
  runDoctor,
} from '../src/doctor/checks.js';
import type { StackAdapter, RunResult } from '../src/adapters/adapter.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'pv-doctor-'));
  dirs.push(d);
  return d;
}
function write(dir: string, rel: string, contents: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// Minimal fake adapter — only what checkToolchain touches.
function fakeAdapter(over: Partial<StackAdapter> & { runResults?: RunResult[] }): StackAdapter {
  const runs = over.runResults ?? [];
  let call = 0;
  return {
    id: 'fake',
    detect: async () => 1,
    install: over.install ?? (async () => {}),
    discover: async () => [],
    probe: async () => ({ target: { kind: 'unit', sourcePath: 'x', name: 'x' }, facts: {}, digest: '', ok: true }),
    run: over.run ?? (async () => runs[Math.min(call++, runs.length - 1)]),
    coverage: async () => ({ statements: 0, branches: 0, functions: 0, lines: 0, ok: false }),
    specFiles: over.specFiles ?? (async () => ['test_x.py']),
    guidance: () => '',
    patternsDoc: async () => '',
    auditRules: () => [],
    commands: () => ({ typecheck: 'true', lint: 'true', testUnit: 'true', testE2e: 'true', coverage: 'true' }),
    ...over,
  } as StackAdapter;
}

const red: RunResult = { passed: 0, failed: 0, skipped: 0, green: false, raw: 'No module named pytest' };
const green: RunResult = { passed: 3, failed: 0, skipped: 0, green: true, raw: '3 passed' };

describe('checkToolchain', () => {
  it('healthy suite → no findings', async () => {
    const d = tmp();
    const r = await checkToolchain(d, fakeAdapter({ runResults: [green] }));
    expect(r.findings).toEqual([]);
  });

  it('no spec files → not a toolchain problem (generate territory)', async () => {
    const d = tmp();
    const r = await checkToolchain(d, fakeAdapter({ specFiles: async () => [] }));
    expect(r.findings).toEqual([]);
  });

  it('runner cannot start → fixable error; fix runs install and re-probes', async () => {
    const d = tmp();
    let installed = false;
    const adapter = fakeAdapter({
      runResults: [red, green],
      install: async () => { installed = true; },
    });
    const r = await checkToolchain(d, adapter);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('error');
    expect(r.findings[0].message).toContain('No module named pytest');
    expect(r.findings[0].fixable).toBe(true);
    const msg = await r.fixes[0].apply();
    expect(installed).toBe(true);
    expect(msg).toContain('repaired');
  });

  it('fix reports honestly when install does not help', async () => {
    const d = tmp();
    const r = await checkToolchain(d, fakeAdapter({ runResults: [red, red] }));
    const msg = await r.fixes[0].apply();
    expect(msg).toContain('still red');
  });
});

describe('checkCoverageBlindspots', () => {
  it('flags src files absent from the coverage report', async () => {
    const d = tmp();
    write(d, 'src/covered.ts', 'export const a = 1;');
    write(d, 'src/server/dark.ts', 'export const b = 2;');
    write(d, 'src/covered.test.ts', ''); // test files don't count
    write(d, 'coverage/coverage-summary.json', JSON.stringify({
      total: {},
      [join(d, 'src/covered.ts')]: { lines: { pct: 100 } },
    }));
    const r = await checkCoverageBlindspots(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toContain('src/server/dark.ts');
    expect(r.findings[0].message).toContain('1 source file(s)');
  });

  it('silent without a coverage report or with full coverage', async () => {
    const d = tmp();
    write(d, 'src/a.ts', 'export const a = 1;');
    expect((await checkCoverageBlindspots(d)).findings).toEqual([]);
    write(d, 'coverage/coverage-summary.json', JSON.stringify({
      total: {},
      [join(d, 'src/a.ts')]: { lines: { pct: 50 } },
    }));
    expect((await checkCoverageBlindspots(d)).findings).toEqual([]);
  });
});

describe('checkPkgManifest', () => {
  it('flags missing "files" entries, passes existing ones (incl. dirs with trailing slash)', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ files: ['bin/', 'README.md', 'dist/'] }));
    write(d, 'bin/x', '#!/bin/sh');
    const r = await checkPkgManifest(d);
    const msgs = r.findings.map((f) => f.message).join('\n');
    expect(msgs).toContain('"README.md"');
    expect(msgs).toContain('"dist/"');
    expect(msgs).not.toContain('"bin/"');
  });

  it('silent without package.json', async () => {
    expect((await checkPkgManifest(tmp())).findings).toEqual([]);
  });
});

describe('checkTrackedArtifacts', () => {
  function gitRepo(): string {
    const d = tmp();
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: d });
    return d;
  }

  it('flags tracked runner artifacts and --fix untracks + gitignores them', async () => {
    const d = gitRepo();
    write(d, 'src/a.ts', 'x');
    write(d, 'coverage.json', '{}');
    write(d, '.probevane-pytest.xml', '<x/>');
    execSync('git add -A && git commit -qm init', { cwd: d });
    const r = await checkTrackedArtifacts(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toContain('coverage.json');
    expect(r.findings[0].fixable).toBe(true);

    const msg = await r.fixes[0].apply();
    expect(msg).toContain('untracked 2');
    const tracked = execSync('git ls-files', { cwd: d }).toString();
    expect(tracked).not.toContain('coverage.json');
    expect(tracked).toContain('src/a.ts');
    expect(readFileSync(join(d, '.gitignore'), 'utf8')).toContain('**/coverage.json');
  });

  it('clean repo (or no git) → silent', async () => {
    const d = gitRepo();
    write(d, 'src/a.ts', 'x');
    execSync('git add -A && git commit -qm init', { cwd: d });
    expect((await checkTrackedArtifacts(d)).findings).toEqual([]);
    expect((await checkTrackedArtifacts(tmp())).findings).toEqual([]);
  });
});

describe('checkCiSwallow', () => {
  it('flags || true on install/test lines with file:line, skips harmless ones', async () => {
    const d = tmp();
    write(d, '.github/workflows/ci.yml', [
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: npm install --no-fund || true',
      '      - run: npm test',
      '      - run: rm -f scratch.txt || true', // no install/test keyword — allowed
    ].join('\n'));
    const r = await checkCiSwallow(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toContain('ci.yml:4');
  });

  it('silent without workflows', async () => {
    expect((await checkCiSwallow(tmp())).findings).toEqual([]);
  });
});

describe('checkStaleCassettes', () => {
  it('flags .miss.json dumps with the $0 re-record hint', async () => {
    const d = tmp();
    write(d, 'eval/cassettes/py-calc.feature.jsonl', '{}');
    write(d, 'eval/cassettes/py-calc.feature.jsonl.miss.json', '{}');
    const r = await checkStaleCassettes(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].hint).toContain('--model bridge');
  });
});

describe('runDoctor', () => {
  it('aggregates all checks; repo-only checks run without an adapter', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ files: ['MISSING.md'] }));
    write(d, 'eval/cassettes/x.jsonl.miss.json', '{}');
    const r = await runDoctor(d);
    const checks = r.findings.map((f) => f.check).sort();
    expect(checks).toEqual(['pkg-manifest', 'stale-cassette']);
  });
});

describe('detector refinements (self-smoke fallout)', () => {
  it('coverage-blindspot respects vitest config excludes', async () => {
    const d = tmp();
    write(d, 'src/cli/glue.ts', 'export const g = 1;');
    write(d, 'src/adapters/x/run.ts', 'export const r = 1;');
    write(d, 'src/dark.ts', 'export const x = 1;');
    write(d, 'vitest.config.mts', `export default { test: { coverage: { exclude: ['src/cli/**', 'src/adapters/*/run.ts'] } } };`);
    write(d, 'coverage/coverage-summary.json', JSON.stringify({ total: {} }));
    const r = await checkCoverageBlindspots(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toContain('src/dark.ts');
    expect(r.findings[0].message).not.toContain('glue');
  });

  it('pkg-manifest allows absent dist/ when a build script exists, still flags README', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ files: ['dist/', 'README.md'], scripts: { build: 'x' } }));
    const r = await checkPkgManifest(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toContain('README.md');
  });

  it('pkg-manifest flags absent dist/ when nothing builds it', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ files: ['dist/'] }));
    expect((await checkPkgManifest(d)).findings).toHaveLength(1);
  });
});

describe('tracked-artifacts __pycache__ pattern', () => {
  it('ignores the whole __pycache__ dir instead of version-baked filenames', async () => {
    const d = mkdtempSync(join(tmpdir(), 'pv-doctor-'));
    dirs.push(d);
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: d });
    write(d, 'pkg/__pycache__/mod.cpython-314.pyc', 'x');
    execSync('git add -A && git commit -qm init', { cwd: d });
    const r = await checkTrackedArtifacts(d);
    await r.fixes[0].apply();
    const gi = readFileSync(join(d, '.gitignore'), 'utf8');
    expect(gi).toContain('**/__pycache__/');
    expect(gi).not.toContain('cpython');
  });
});

// ---------------------------------------------------------------------------
// lane checks 7-12 + --full scorecard
// ---------------------------------------------------------------------------
import {
  checkNodeModules,
  checkPlaywrightBrowsers,
  checkConfig,
  checkCredentials,
  checkEvalBijection,
  checkStaleCoverageReport,
} from '../src/doctor/checks.js';
import { fullReport } from '../src/doctor/full.js';
import { utimesSync } from 'node:fs';

describe('checkNodeModules', () => {
  it('flags declared deps without node_modules; picks npm ci with a lockfile', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { vitest: '^2' } }));
    write(d, 'package-lock.json', '{}');
    const r = await checkNodeModules(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].hint).toBe('npm ci');
    expect(r.findings[0].fixable).toBe(true);
  });
  it('silent when node_modules exists or no deps declared', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { vitest: '^2' } }));
    mkdirSync(join(d, 'node_modules'));
    expect((await checkNodeModules(d)).findings).toEqual([]);
    const e = tmp();
    write(e, 'package.json', JSON.stringify({ name: 'x' }));
    expect((await checkNodeModules(e)).findings).toEqual([]);
  });
});

describe('checkPlaywrightBrowsers', () => {
  it('flags a playwright config with an empty browser cache', async () => {
    const d = tmp();
    write(d, 'playwright.config.ts', 'export default {};');
    const cache = tmp();
    const old = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
    try {
      const r = await checkPlaywrightBrowsers(d);
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0].fixable).toBe(true);
      mkdirSync(join(cache, 'chromium-1234'));
      expect((await checkPlaywrightBrowsers(d)).findings).toEqual([]);
    } finally {
      if (old === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = old;
    }
  });
  it('silent without a playwright config', async () => {
    expect((await checkPlaywrightBrowsers(tmp())).findings).toEqual([]);
  });
});

describe('checkConfig', () => {
  it('flags schema violations in probevane.config.json', async () => {
    const d = tmp();
    write(d, 'probevane.config.json', JSON.stringify({ minTests: 'lots', unknownKey: 1 }));
    const r = await checkConfig(d);
    expect(r.findings.length).toBeGreaterThanOrEqual(1);
    expect(r.findings.every((f) => f.check === 'config-invalid')).toBe(true);
  });
  it('flags unparseable config as a load failure', async () => {
    const d = tmp();
    write(d, 'probevane.config.json', '{not json');
    const r = await checkConfig(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toContain('failed to load');
  });
  it('silent with a valid config or none at all', async () => {
    const d = tmp();
    write(d, 'probevane.config.json', JSON.stringify({ minTests: 5 }));
    expect((await checkConfig(d)).findings).toEqual([]);
    expect((await checkConfig(tmp())).findings).toEqual([]);
  });
});

describe('checkCredentials', () => {
  it('warns without ANTHROPIC_API_KEY, silent with it', async () => {
    const old = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      const r = await checkCredentials('.');
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0].severity).toBe('warn');
      expect(r.findings[0].hint).toContain('bridge');
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      expect((await checkCredentials('.')).findings).toEqual([]);
    } finally {
      if (old === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = old;
    }
  });
});

describe('checkEvalBijection', () => {
  it('errors on case without fixture/baseline; warns on unguarded fixture + orphaned baseline', async () => {
    const d = tmp();
    write(d, 'eval/cases.jsonl', JSON.stringify({ fixture: 'ghost', kind: 'unit' }) + '\n');
    write(d, 'fixtures/lonely/app.py', 'def f(): pass');
    write(d, 'eval/baseline/orphan.unit.json', '{}');
    write(d, 'eval/baseline/lonely.repair.json', '{}'); // path baseline — must NOT be flagged
    const r = await checkEvalBijection(d);
    const msgs = r.findings.map((f) => `${f.severity}:${f.message}`);
    expect(msgs.some((m) => m.startsWith('error:') && m.includes('ghost.unit has no fixtures/ghost/'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('error:') && m.includes('ghost.unit.json'))).toBe(true);
    expect(msgs.some((m) => m.includes('fixtures/lonely/ has no eval case'))).toBe(true);
    expect(msgs.some((m) => m.includes('orphan.unit.json is orphaned'))).toBe(true);
    expect(msgs.some((m) => m.includes('lonely.repair'))).toBe(false);
  });
  it('silent without eval/cases.jsonl', async () => {
    expect((await checkEvalBijection(tmp())).findings).toEqual([]);
  });
});

describe('checkStaleCoverageReport', () => {
  it('warns when a test file is newer than the coverage report', async () => {
    const d = tmp();
    write(d, 'coverage/coverage-summary.json', '{}');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(d, 'coverage/coverage-summary.json'), past, past);
    write(d, 'tests/new.test.ts', 'it');
    const r = await checkStaleCoverageReport(d);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toContain('tests/new.test.ts');
  });
  it('silent when the report is fresh or absent', async () => {
    const d = tmp();
    write(d, 'tests/old.test.ts', 'it');
    expect((await checkStaleCoverageReport(d)).findings).toEqual([]); // no report
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(d, 'tests/old.test.ts'), past, past);
    write(d, 'coverage/coverage-summary.json', '{}');
    expect((await checkStaleCoverageReport(d)).findings).toEqual([]);
  });
});

describe('fullReport', () => {
  it('adapterless: quality + arch + skipped heavies, no audit/coverage lines', async () => {
    const d = tmp();
    write(d, 'src/a.ts', 'export const a = 1;\n');
    const lines = await fullReport(d);
    const areas = lines.map((l) => l.area);
    expect(areas).toContain('quality');
    expect(areas).toContain('arch');
    expect(areas).toContain('mutation');
    expect(areas).toContain('flake');
    expect(areas).not.toContain('audit');
    expect(areas).not.toContain('coverage');
    expect(lines.find((l) => l.area === 'mutation')!.summary).toContain('probevane mutation');
  });

  it('with an adapter: audits specs, scores assertions, reads coverage', async () => {
    const d = tmp();
    write(d, 'src/a.ts', 'export const a = 1;\n');
    write(d, 'src/a.test.ts', "import { it, expect } from 'vitest';\nit('x', () => { expect(1 + 1).toBe(2); });\n");
    const adapter = fakeAdapter({
      specFiles: async () => ['src/a.test.ts'],
      coverage: async () => ({ statements: 95, branches: 90, functions: 92, lines: 95, ok: true }),
      auditRules: () => [],
    });
    const lines = await fullReport(d, adapter);
    const byArea = Object.fromEntries(lines.map((l) => [l.area, l]));
    expect(byArea.audit.ok).toBe(true);
    expect(byArea.assertions.summary).toMatch(/\/100 strong/);
    expect(byArea.coverage.ok).toBe(true);
    expect(byArea.coverage.summary).toContain('95% lines');
  });

  it('flags missing specs and unavailable coverage as not-ok', async () => {
    const d = tmp();
    write(d, 'src/a.ts', 'export const a = 1;\n');
    const adapter = fakeAdapter({
      specFiles: async () => [],
      coverage: async () => ({ statements: 0, branches: 0, functions: 0, lines: 0, ok: false }),
    });
    const lines = await fullReport(d, adapter);
    const byArea = Object.fromEntries(lines.map((l) => [l.area, l]));
    expect(byArea.audit.ok).toBe(false);
    expect(byArea.coverage.ok).toBe(false);
  });
});
