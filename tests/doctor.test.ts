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
