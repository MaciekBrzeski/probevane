import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedFiles, isSourceFile, specCandidatesFor } from '../src/git.js';

// ===========================================================================
// isSourceFile — pure classifier, table-tested
// ===========================================================================
describe('isSourceFile', () => {
  it.each([
    'src/App.tsx',
    'src/utils.ts',
    'lib/helper.js',
    'components/Button.jsx',
    'src/Widget.vue',
    'src/Widget.svelte',
    'pkg/mod.py',
    'cmd/server.go',
    'src/indexer.ts', // "index" prefix but not the entry file itself
    'src/mainframe.ts', // "main" prefix but not the entry file itself
  ])('accepts user source: %s', (f) => {
    expect(isSourceFile(f)).toBe(true);
  });

  it.each([
    'README.md',
    'styles.css',
    'data.json',
  ])('rejects non-code extensions: %s', (f) => {
    expect(isSourceFile(f)).toBe(false);
  });

  it.each([
    'src/App.test.tsx',
    'src/utils.spec.ts',
    'src/types.d.ts',
    'tests/test_mod.py',
    'conftest.py',
    'pkg/conftest.py',
    'server_test.go',
  ])('rejects test/declaration files: %s', (f) => {
    expect(isSourceFile(f)).toBe(false);
  });

  it.each([
    'vite.config.ts',
    'vitest.config.mjs',
    'playwright.config.js',
    'vitest.setup.ts',
    'src/setupTests.ts',
    'src/vite-env.d.ts',
  ])('rejects config/setup files: %s', (f) => {
    expect(isSourceFile(f)).toBe(false);
  });

  it.each([
    'src/__mocks__/api.ts',
    'mocks/server.ts',
    'node_modules/pkg/index.ts',
    'src/main.tsx',
    'src/index.ts',
    'main.js',
    'index.jsx',
  ])('rejects mocks/deps/entry files: %s', (f) => {
    expect(isSourceFile(f)).toBe(false);
  });
});

// ===========================================================================
// specCandidatesFor — sibling naming conventions per language
// ===========================================================================
describe('specCandidatesFor', () => {
  it('JS/TS family: test + spec siblings in tsx-then-ts order', () => {
    expect(specCandidatesFor('src/Foo.tsx')).toEqual([
      'src/Foo.test.tsx',
      'src/Foo.test.ts',
      'src/Foo.spec.tsx',
      'src/Foo.spec.ts',
    ]);
    expect(specCandidatesFor('lib/util.js')).toEqual([
      'lib/util.test.tsx',
      'lib/util.test.ts',
      'lib/util.spec.tsx',
      'lib/util.spec.ts',
    ]);
    expect(specCandidatesFor('a/b/Widget.vue')).toEqual([
      'a/b/Widget.test.tsx',
      'a/b/Widget.test.ts',
      'a/b/Widget.spec.tsx',
      'a/b/Widget.spec.ts',
    ]);
  });

  it('python: test_<base>.py sibling + <base>_test.py', () => {
    expect(specCandidatesFor('pkg/mod.py')).toEqual(['pkg/test_mod.py', 'pkg/mod_test.py']);
  });

  it('python top-level file (no directory prefix)', () => {
    expect(specCandidatesFor('mod.py')).toEqual(['test_mod.py', 'mod_test.py']);
  });

  it('unknown extensions → no candidates', () => {
    expect(specCandidatesFor('cmd/server.go')).toEqual([]);
    expect(specCandidatesFor('style.css')).toEqual([]);
    expect(specCandidatesFor('README.md')).toEqual([]);
  });
});

// ===========================================================================
// changedFiles — real git repo in a temp dir (worktree.test.ts precedent)
// ===========================================================================
describe('changedFiles (scratch git repo)', () => {
  let repo: string;
  const g = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pv-githelp-'));
    g('init', '-q');
    g('config', 'user.email', 't@t.t');
    g('config', 'user.name', 'T');
    g('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'b.ts'), 'export const b = 2;\n');
    writeFileSync(join(repo, '.gitignore'), 'ignored.log\n');
    g('add', '-A');
    g('commit', '-qm', 'init');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('clean tree → no changed files', async () => {
    expect(await changedFiles(repo)).toEqual([]);
  });

  it('reports unstaged modifications + untracked files, once each', async () => {
    writeFileSync(join(repo, 'a.ts'), 'export const a = 99;\n'); // modified, unstaged
    writeFileSync(join(repo, 'c.ts'), 'export const c = 3;\n'); // untracked
    const files = await changedFiles(repo);
    expect(files.sort()).toEqual(['a.ts', 'c.ts']);
  });

  it('includes staged-but-uncommitted changes (diff vs HEAD)', async () => {
    writeFileSync(join(repo, 'b.ts'), 'export const b = 42;\n');
    g('add', 'b.ts');
    expect(await changedFiles(repo)).toEqual(['b.ts']);
  });

  it('a file both modified AND untracked-sibling dedupes into a set', async () => {
    writeFileSync(join(repo, 'a.ts'), 'changed\n');
    writeFileSync(join(repo, 'a.ts'), 'changed again\n'); // same path twice — still one entry
    const files = await changedFiles(repo);
    expect(files).toEqual(['a.ts']);
  });

  it('respects .gitignore for untracked files (--exclude-standard)', async () => {
    writeFileSync(join(repo, 'ignored.log'), 'noise\n');
    expect(await changedFiles(repo)).toEqual([]);
  });

  it('diffs against an explicit ref: committed change shows vs HEAD~1, not vs HEAD', async () => {
    writeFileSync(join(repo, 'a.ts'), 'export const a = 2;\n');
    g('add', 'a.ts');
    g('commit', '-qm', 'bump a');
    expect(await changedFiles(repo)).toEqual([]); // clean vs HEAD
    expect(await changedFiles(repo, 'HEAD~1')).toEqual(['a.ts']); // visible vs parent
  });
});
