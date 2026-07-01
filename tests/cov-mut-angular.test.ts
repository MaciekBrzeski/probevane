import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { angularAdapter } from '../src/adapters/angular/index.js';
import type { RunScope } from '../src/adapters/adapter.js';

// --- temp dir bookkeeping (same helpers as cov-adapters*.test.ts) ---------
const dirs: string[] = [];
function tmp(prefix = 'pv-covmut-ng-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function write(dir: string, rel: string, contents: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

// A package.json that already declares jest-preset-angular so install() skips
// the `npm install` sh() branch entirely — no subprocess / mock required. This
// lets us drive the config-writing branch (the ONLY user of exists()) directly.
const pkgWithPreset = JSON.stringify({ devDependencies: { '@angular/core': '17', 'jest-preset-angular': '17' } });

// =========================================================================
// MUTANT — angular/index.ts:15
//   `const exists = (p) => access(p).then(()=>true).catch(()=>false)`  (true → false)
// exists() is used ONLY inside install(). With the mutant it always returns
// false, so the config-writing branch always fires and CLOBBERS a config that
// already exists. Correct exists() → true → the branch is skipped → the
// user's existing jest.config.js is left untouched.
// =========================================================================
describe('angularAdapter.install — exists() detects a present config (kills true → false)', () => {
  it('does NOT overwrite an existing jest.config.js', async () => {
    const d = tmp();
    write(d, 'package.json', pkgWithPreset);
    write(d, 'jest.config.js', '/* SENTINEL user config */ module.exports = { testMatch: ["custom"] };\n');
    await angularAdapter.install(d);
    const content = readFileSync(join(d, 'jest.config.js'), 'utf8');
    // Correct exists() → true → branch skipped → sentinel survives.
    // Mutant exists()==false → branch runs → file rewritten to createCjsPreset.
    expect(content).toContain('SENTINEL');
    expect(content).not.toContain('createCjsPreset');
  });
});

// =========================================================================
// MUTANT — angular/index.ts:41
//   `if (!(await exists(jest.config.js)) && !(await exists(jest.config.ts))) ...`  (&& → ||)
// With ONE jest config present (jest.config.js) and the other absent:
//   correct &&: !true && !false = false && true = false → branch SKIPPED
//   mutant  ||: !true || !false = false || true = true  → branch RUNS
// The branch's tell-tale side effect is writing setup-jest.ts. So with one
// config present, correct code leaves setup-jest.ts absent; the || mutant
// creates it (and clobbers jest.config.js). The none-present case can't tell
// them apart (both write), so we assert on the one-present case.
// =========================================================================
describe('angularAdapter.install — one config present skips the write branch (kills && → ||)', () => {
  it('does NOT create setup-jest.ts when jest.config.js already exists', async () => {
    const d = tmp();
    write(d, 'package.json', pkgWithPreset);
    write(d, 'jest.config.js', '/* SENTINEL user config */\n'); // one config present, .ts absent
    await angularAdapter.install(d);
    // Correct && → branch skipped → setup-jest.ts never written.
    // Mutant  || → branch runs → setup-jest.ts is created.
    expect(existsSync(join(d, 'setup-jest.ts'))).toBe(false);
  });
});

// =========================================================================
// MUTANT — angular/index.ts:83
//   `const scoped = files?.length ? ' ' + files.map(f=>JSON.stringify(f)).join(' ') : ''`  (+ → -)
// The `+` is string concatenation building the jest CLI arg list. The mutant
// `' ' - <joined string>` evaluates to NaN, so the scoped file args vanish
// from the command (…--testLocationInResultsNaN). run() module-mocks sh(), so
// we capture the exact command string and assert the joined files are present.
// =========================================================================
describe('angularAdapter.run — scoped files are concatenated into the jest command (kills + → -)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/util/exec.js');
  });

  it('includes the JSON-quoted file list in the spawned command', async () => {
    let captured = '';
    vi.resetModules();
    vi.doMock('../src/util/exec.js', () => ({
      sh: async (cmd: string) => { captured = cmd; return { ok: true, code: 0, stdout: '', stderr: '' }; },
      capOutput: (s: string) => s,
    }));
    const { angularAdapter: ng } = await import('../src/adapters/angular/index.js');
    const d = tmp();
    await ng.run(d, {} as RunScope, ['a.spec.ts', 'b.spec.ts']);
    // Correct + → ` "a.spec.ts" "b.spec.ts"` appended to the command.
    // Mutant - → scoped is NaN → command ends `...--testLocationInResultsNaN`.
    expect(captured).toContain(' "a.spec.ts" "b.spec.ts"');
    expect(captured).not.toContain('NaN');
  });
});
