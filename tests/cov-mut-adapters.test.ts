import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reactAdapter } from '../src/adapters/react-vitest-playwright/index.js';
import { vueAdapter } from '../src/adapters/vue-vitest-playwright/index.js';
import { pythonAdapter } from '../src/adapters/python-pytest/index.js';
import { discoverReact } from '../src/adapters/react-vitest-playwright/discover.js';
import type { TestTarget, RunScope } from '../src/adapters/adapter.js';

// --- temp dir bookkeeping (same helpers as cov-adapters*.test.ts) ---------
const dirs: string[] = [];
function tmp(prefix = 'pv-covmut-'): string {
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
const unit = (sourcePath: string, name = sourcePath): TestTarget => ({ kind: 'unit', sourcePath, name });

// =========================================================================
// MUTANT #3 — react-vitest-playwright/index.ts:40
//   `return kind === 'unit' ? <unit guidance> : <e2e guidance>`   (=== → !==)
// Existing tests never assert guidance() picks the right branch by kind.
// =========================================================================
describe('reactAdapter.guidance — branch by kind (kills === → !==)', () => {
  it('unit kind returns the vitest/@testing-library guidance', () => {
    const g = reactAdapter.guidance('unit');
    expect(g).toContain('@testing-library/react');
    expect(g).not.toContain('@playwright/test'); // would leak in on a swapped branch
  });

  it('e2e kind returns the Playwright guidance', () => {
    const g = reactAdapter.guidance('e2e');
    expect(g).toContain('@playwright/test');
    expect(g).not.toContain('@testing-library/react');
  });
});

// =========================================================================
// MUTANT #5 — vue-vitest-playwright/index.ts:26
//   `if (deps.vue) score += 0.6`   (+ → -)
// Pin the EXACT 0.6 contribution: with `-` a vue-only project scores -0.6.
// =========================================================================
describe('vueAdapter.detect — vue contributes +0.6 (kills + → -)', () => {
  it('scores a vue-only project at exactly 0.6', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { vue: '3' } }));
    expect(await vueAdapter.detect(d)).toBeCloseTo(0.6); // mutant → -0.6
  });

  it('scores vue + @vitejs/plugin-vue at 0.9 (0.6 + 0.3)', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { vue: '3' }, devDependencies: { '@vitejs/plugin-vue': '5' } }));
    expect(await vueAdapter.detect(d)).toBeCloseTo(0.9); // mutant → -0.6 + 0.3 = -0.3
  });
});

// =========================================================================
// MUTANT #4 — python-pytest/index.ts:84
//   `const ok = funcs.length + classes.length > 0`   (+ → -)
// A classes-ONLY module (funcs.length 0, classes.length 1): `-` → -1 > 0 false.
// =========================================================================
describe('pythonAdapter.probe — classes-only module is detected (kills + → -)', () => {
  it('a module with only classes (no top-level funcs) probes ok:true', async () => {
    const d = tmp();
    write(d, 'shapes.py', 'class Circle:\n    def area(self):\n        return 3\n');
    const r = await pythonAdapter.probe(d, unit('shapes.py', 'shapes'));
    expect(r.facts.funcs).toEqual([]); // no top-level def → the `+` term is 0
    expect(r.facts.classes).toContain('Circle');
    expect(r.ok).toBe(true); // 0 + 1 > 0; mutant `0 - 1 > 0` is false
    expect(r.error).toBeUndefined();
  });
});

// =========================================================================
// MUTANT #6 — react-vitest-playwright/discover.ts:11
//   `if (/\.(test|spec|d)\.[tj]sx?$/.test(f)) return true`   (true → false)
// A `.test.tsx` file must be EXCLUDED. baseName keeps `Foo.test` as the name,
// so assert the full base name is absent (mutant would include it).
// =========================================================================
describe('discoverReact — test/spec/decl files are skipped (kills true → false)', () => {
  it('excludes a .test.tsx and a .spec.ts, keeps the real source', async () => {
    const d = tmp();
    write(d, 'src/Widget.tsx', 'export function Widget() { return <div/>; }');
    write(d, 'src/Foo.test.tsx', 'export function Foo() { return <div/>; }'); // must be skipped
    write(d, 'src/bar.spec.ts', 'export const bar = 1;'); // must be skipped
    write(d, 'src/model.d.ts', 'export type T = number;'); // must be skipped (.d)
    const names = (await discoverReact(d, 'unit')).map((t) => t.name);
    expect(names).toContain('Widget');
    expect(names).not.toContain('Foo.test'); // mutant would surface this
    expect(names).not.toContain('bar.spec');
    expect(names).not.toContain('model.d');
  });
});

// =========================================================================
// MUTANT #1 — angular/index.ts:94
//   `green: r.ok && failed === 0 && passed > 0`   (=== → !==)
// Drive run() with sh mocked green + a jest report that has failures.
// With `!==` a failing suite would be reported green. Assert green === false.
// =========================================================================
describe('angularAdapter.run — failures make green false (kills === → !==)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/util/exec.js');
  });

  it('green is false when the jest report has failed tests (r.ok, passed>0)', async () => {
    vi.resetModules();
    vi.doMock('../src/util/exec.js', () => ({
      sh: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }),
      capOutput: (s: string) => s,
    }));
    const { angularAdapter } = await import('../src/adapters/angular/index.js');
    const d = tmp();
    // sh is a no-op mock → this pre-written report is what run() parses.
    write(d, '.probevane-jest.json', JSON.stringify({ numPassedTests: 3, numFailedTests: 2, numPendingTests: 0 }));
    const r = await angularAdapter.run(d, {} as RunScope);
    expect(r.passed).toBe(3);
    expect(r.failed).toBe(2);
    expect(r.green).toBe(false); // === keeps it false; mutant !== flips to true
  });

  it('green is true only when failed === 0 and passed > 0', async () => {
    vi.resetModules();
    vi.doMock('../src/util/exec.js', () => ({
      sh: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }),
      capOutput: (s: string) => s,
    }));
    const { angularAdapter } = await import('../src/adapters/angular/index.js');
    const d = tmp();
    write(d, '.probevane-jest.json', JSON.stringify({ numPassedTests: 4, numFailedTests: 0, numPendingTests: 0 }));
    const r = await angularAdapter.run(d, {} as RunScope);
    expect(r.green).toBe(true);
  });
});

// =========================================================================
// MUTANT #2 — go-test/index.ts:29
//   `else if (e.Action === 'fail') counts.failed++`   (=== → !==)
// Feed a canned `go test -json` stream with one pass + one fail event.
// With `!==`, the 'fail' event no longer increments failed → failed 0.
// =========================================================================
describe('goAdapter.run — a fail event increments failed (kills === → !==)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/util/exec.js');
  });

  it('counts a JSON fail event as a failure (green false)', async () => {
    const stream = [
      '{"Test":"TestPass","Action":"pass"}',
      '{"Test":"TestFail","Action":"fail"}',
      '',
    ].join('\n');
    vi.resetModules();
    vi.doMock('../src/util/exec.js', () => ({
      sh: async () => ({ ok: true, code: 0, stdout: stream, stderr: '' }),
      capOutput: (s: string) => s,
    }));
    const { goAdapter } = await import('../src/adapters/go-test/index.js');
    const r = await goAdapter.run(tmp(), {} as RunScope);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1); // mutant `!== 'fail'` leaves failed at 0
    expect(r.green).toBe(false); // failed > 0 → not green; mutant would be green
  });
});
