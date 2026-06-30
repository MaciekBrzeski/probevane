import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pythonAdapter } from '../src/adapters/python-pytest/index.js';
import { goAdapter } from '../src/adapters/go-test/index.js';
import { rustAdapter } from '../src/adapters/rust-cargo/index.js';
import { angularAdapter } from '../src/adapters/angular/index.js';
import { nodeAdapter } from '../src/adapters/node-vitest/index.js';
import type { TestTarget } from '../src/adapters/adapter.js';

// --- temp dir bookkeeping -------------------------------------------------
const dirs: string[] = [];
function tmp(prefix = 'pv-cov2-'): string {
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
// python-pytest — detect
// =========================================================================
describe('pythonAdapter.detect', () => {
  it('scores pyproject + requirements + a .py file, capped at 1', async () => {
    const d = tmp();
    write(d, 'pyproject.toml', '[project]\nname="x"\n');
    write(d, 'requirements.txt', 'pytest\n');
    write(d, 'app.py', 'x = 1\n');
    expect(await pythonAdapter.detect(d)).toBe(1); // 0.5 + 0.3 + 0.3 capped
  });

  it('scores pyproject alone at 0.5', async () => {
    const d = tmp();
    write(d, 'pyproject.toml', '[project]\n');
    expect(await pythonAdapter.detect(d)).toBeCloseTo(0.5);
  });

  it('scores requirements.txt alone at 0.3', async () => {
    const d = tmp();
    write(d, 'requirements.txt', 'flask\n');
    expect(await pythonAdapter.detect(d)).toBeCloseTo(0.3);
  });

  it('scores a lone .py source at 0.3', async () => {
    const d = tmp();
    write(d, 'main.py', 'print(1)\n');
    expect(await pythonAdapter.detect(d)).toBeCloseTo(0.3);
  });

  it('returns 0 for an empty dir (no manifest, no .py)', async () => {
    expect(await pythonAdapter.detect(tmp())).toBe(0);
  });
});

// =========================================================================
// python-pytest — discover
// =========================================================================
describe('pythonAdapter.discover', () => {
  it('finds .py sources and skips test_/conftest/_test files + skip dirs', async () => {
    const d = tmp();
    write(d, 'app.py', 'def f(): pass\n');
    write(d, 'pkg/util.py', 'def g(): pass\n');
    write(d, 'test_app.py', '');       // skipped (test_)
    write(d, 'conftest.py', '');        // skipped (conftest)
    write(d, 'app_test.py', '');        // skipped (_test.py)
    write(d, 'pkg/sub_test.py', '');    // skipped nested (_test.py)
    write(d, '__pycache__/cache.py', ''); // skip dir
    write(d, '.venv/lib/x.py', '');     // skip dir
    write(d, 'readme.md', '');          // not .py
    const targets = await pythonAdapter.discover(d, 'unit');
    const names = targets.map((t) => t.name);
    expect(names).toContain('app');
    expect(names).toContain('pkg.util'); // path → dotted module name
    expect(names).not.toContain('test_app');
    expect(names).not.toContain('conftest');
    expect(names.some((n) => n.includes('_test'))).toBe(false);
    expect(names.some((n) => n.includes('cache'))).toBe(false);
    expect(targets.every((t) => t.kind === 'unit')).toBe(true);
    expect(targets.every((t) => t.sourcePath.endsWith('.py'))).toBe(true);
  });

  it('returns [] for an empty dir', async () => {
    expect(await pythonAdapter.discover(tmp(), 'unit')).toEqual([]);
  });
});

// =========================================================================
// python-pytest — probe
// =========================================================================
describe('pythonAdapter.probe', () => {
  it('extracts top-level functions, classes and raises (methods inside classes ignored)', async () => {
    const d = tmp();
    write(
      d,
      'pkg/mod.py',
      `import os

def add(a, b):
    return a + b

def boom(x):
    raise ValueError("bad")

class Widget:
    def method(self):
        raise KeyError("k")
`,
    );
    const r = await pythonAdapter.probe(d, unit('pkg/mod.py', 'pkg.mod'));
    expect(r.ok).toBe(true);
    expect(r.facts.funcs).toContain('add(a, b)');
    expect(r.facts.funcs).toContain('boom(x)');
    expect((r.facts.funcs as string[]).some((f) => f.startsWith('method'))).toBe(false); // indented → not ^def
    expect(r.facts.classes).toContain('Widget');
    expect(r.facts.raises).toContain('ValueError');
    expect(r.facts.raises).toContain('KeyError');
    expect(r.digest).toContain('GROUND TRUTH for pkg/mod.py (import from "pkg.mod")');
    expect(r.digest).toMatch(/functions: add\(a, b\); boom\(x\)/);
    expect(r.digest).toContain('classes: Widget');
    expect(r.digest).toMatch(/raises: .*ValueError/);
    expect(r.error).toBeUndefined();
  });

  it('returns ok:false "no defs found" for a file with no funcs/classes', async () => {
    const d = tmp();
    write(d, 'empty.py', 'X = 1\nY = 2\n');
    const r = await pythonAdapter.probe(d, unit('empty.py', 'empty'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no defs found');
    expect(r.digest).toContain('GROUND TRUTH for empty.py');
  });

  it('returns ok:false "cannot read" when the file is missing (catch path)', async () => {
    const r = await pythonAdapter.probe(tmp(), unit('gone.py', 'gone'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot read gone\.py/);
    expect(r.digest).toBe('');
  });
});

// =========================================================================
// go-test — detect
// =========================================================================
describe('goAdapter.detect', () => {
  it('scores go.mod + a .go file, capped at 1', async () => {
    const d = tmp();
    write(d, 'go.mod', 'module x\n\ngo 1.22\n');
    write(d, 'main.go', 'package main\n');
    expect(await goAdapter.detect(d)).toBeCloseTo(0.9); // 0.6 + 0.3
  });

  it('scores go.mod alone at 0.6', async () => {
    const d = tmp();
    write(d, 'go.mod', 'module x\n');
    expect(await goAdapter.detect(d)).toBeCloseTo(0.6);
  });

  it('scores a lone .go file at 0.3 (no go.mod)', async () => {
    const d = tmp();
    write(d, 'lib.go', 'package lib\n');
    expect(await goAdapter.detect(d)).toBeCloseTo(0.3);
  });

  it('returns 0 for an empty dir', async () => {
    expect(await goAdapter.detect(tmp())).toBe(0);
  });
});

// =========================================================================
// go-test — discover
// =========================================================================
describe('goAdapter.discover', () => {
  it('lists .go sources, skips _test.go and vendor/node_modules/.git dirs', async () => {
    const d = tmp();
    write(d, 'add.go', 'package m\n');
    write(d, 'pkg/util.go', 'package pkg\n');
    write(d, 'add_test.go', 'package m\n');        // skipped (_test.go)
    write(d, 'pkg/util_test.go', 'package pkg\n');  // skipped (_test.go)
    write(d, 'vendor/dep/x.go', 'package dep\n');    // skip dir
    write(d, 'node_modules/y.go', '');               // skip dir
    write(d, 'readme.md', '');                        // not .go
    const targets = await goAdapter.discover(d, 'unit');
    const names = targets.map((t) => t.name);
    expect(names).toContain('add');
    expect(names).toContain('util');
    expect(names.some((n) => n.includes('test'))).toBe(false);
    expect(targets.some((t) => t.sourcePath.includes('vendor'))).toBe(false);
    expect(targets.find((t) => t.name === 'util')!.sourcePath).toBe(join('pkg', 'util.go'));
    expect(targets.every((t) => t.kind === 'unit')).toBe(true);
  });

  it('returns [] for an empty dir', async () => {
    expect(await goAdapter.discover(tmp(), 'unit')).toEqual([]);
  });
});

// =========================================================================
// go-test — probe
// =========================================================================
describe('goAdapter.probe', () => {
  it('extracts package, exported funcs (with returns) and exported struct types', async () => {
    const d = tmp();
    write(
      d,
      'mathx.go',
      `package mathx

import "fmt"

func Add(a int, b int) int {
	return a + b
}

func Greet(name string) string {
	return fmt.Sprintf("hi %s", name)
}

func internalHelper() {
}

type Point struct {
	X int
	Y int
}
`,
    );
    const r = await goAdapter.probe(d, unit('mathx.go', 'mathx'));
    expect(r.ok).toBe(true);
    expect(r.facts.pkg).toBe('mathx');
    expect(r.facts.fns).toContain('Add(a int, b int) int');
    expect(r.facts.fns).toContain('Greet(name string) string');
    expect((r.facts.fns as string[]).some((f) => f.startsWith('internalHelper'))).toBe(false); // unexported
    expect(r.digest).toContain('GROUND TRUTH for mathx.go (package mathx)');
    expect(r.digest).toMatch(/exported funcs: Add\(a int, b int\) int/);
    expect(r.digest).toContain('exported types: Point');
    expect(r.digest).toContain('table-driven test');
    expect(r.error).toBeUndefined();
  });

  it('returns ok:false "no exported funcs" when only unexported funcs exist', async () => {
    const d = tmp();
    write(d, 'priv.go', 'package p\n\nfunc helper() int {\n\treturn 1\n}\n');
    const r = await goAdapter.probe(d, unit('priv.go', 'priv'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no exported funcs');
    expect(r.digest).toContain('package p');
  });

  it('returns ok:false on a missing file (readFile catch → empty source)', async () => {
    const r = await goAdapter.probe(tmp(), unit('missing.go', 'missing'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no exported funcs');
    expect(r.facts.pkg).toBe('');
  });
});

// =========================================================================
// rust-cargo — detect
// =========================================================================
describe('rustAdapter.detect', () => {
  it('scores Cargo.toml + src/lib.rs, capped within range', async () => {
    const d = tmp();
    write(d, 'Cargo.toml', '[package]\nname = "x"\n');
    write(d, 'src/lib.rs', 'pub fn f() {}\n');
    expect(await rustAdapter.detect(d)).toBeCloseTo(0.9); // 0.7 + 0.2
  });

  it('counts src/main.rs toward the +0.2 root score', async () => {
    const d = tmp();
    write(d, 'Cargo.toml', '[package]\nname = "x"\n');
    write(d, 'src/main.rs', 'fn main() {}\n');
    expect(await rustAdapter.detect(d)).toBeCloseTo(0.9);
  });

  it('scores Cargo.toml alone at 0.7', async () => {
    const d = tmp();
    write(d, 'Cargo.toml', '[package]\nname = "x"\n');
    expect(await rustAdapter.detect(d)).toBeCloseTo(0.7);
  });

  it('scores a lone src/lib.rs (no Cargo.toml) at 0.2', async () => {
    const d = tmp();
    write(d, 'src/lib.rs', 'pub fn f() {}\n');
    expect(await rustAdapter.detect(d)).toBeCloseTo(0.2);
  });

  it('returns 0 for an empty dir', async () => {
    expect(await rustAdapter.detect(tmp())).toBe(0);
  });
});

// =========================================================================
// rust-cargo — discover
// =========================================================================
describe('rustAdapter.discover', () => {
  it('targets src/lib.rs when present', async () => {
    const d = tmp();
    write(d, 'src/lib.rs', 'pub fn f() {}\n');
    const targets = await rustAdapter.discover(d, 'unit');
    expect(targets).toHaveLength(1);
    expect(targets[0].sourcePath).toBe('src/lib.rs');
    expect(targets[0].name).toBe('lib');
    expect(targets[0].kind).toBe('unit');
  });

  it('falls back to src/main.rs when no lib.rs', async () => {
    const d = tmp();
    write(d, 'src/main.rs', 'fn main() {}\n');
    const targets = await rustAdapter.discover(d, 'unit');
    expect(targets[0].sourcePath).toBe('src/main.rs');
  });
});

// =========================================================================
// rust-cargo — probe (incl. crateName helper branches)
// =========================================================================
describe('rustAdapter.probe', () => {
  it('extracts pub fns with params + return, resolves crate name (dashes → underscores)', async () => {
    const d = tmp();
    write(d, 'Cargo.toml', '[package]\nname = "my-crate"\nversion = "0.1.0"\n');
    write(
      d,
      'src/lib.rs',
      `pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

fn private_helper() -> bool { true }

pub fn greet(name: &str) -> String {
    format!("hi {name}")
}
`,
    );
    const r = await rustAdapter.probe(d, unit('src/lib.rs', 'lib'));
    expect(r.ok).toBe(true);
    expect(r.facts.crate).toBe('my_crate'); // dash → underscore
    expect(r.facts.fns).toContain('add(a: i32, b: i32) -> i32');
    expect(r.facts.fns).toContain('greet(name: &str) -> String');
    expect((r.facts.fns as string[]).some((f) => f.startsWith('private_helper'))).toBe(false); // not pub
    expect(r.digest).toContain('GROUND TRUTH for src/lib.rs (crate `my_crate`)');
    expect(r.digest).toMatch(/pub fns: add\(a: i32, b: i32\) -> i32/);
    expect(r.digest).toContain('use my_crate::*;');
    expect(r.error).toBeUndefined();
  });

  it('falls back to crate name "crate" when Cargo.toml is missing/nameless', async () => {
    const d = tmp();
    // no Cargo.toml at all → crateName reads '' → default 'crate'
    write(d, 'src/lib.rs', 'pub fn ping() {}\n');
    const r = await rustAdapter.probe(d, unit('src/lib.rs', 'lib'));
    expect(r.ok).toBe(true);
    expect(r.facts.crate).toBe('crate');
    expect(r.facts.fns).toContain('ping()');
  });

  it('returns ok:false "no pub fns" for a missing source file (readFile catch)', async () => {
    const d = tmp();
    write(d, 'Cargo.toml', '[package]\nname = "z"\n');
    const r = await rustAdapter.probe(d, unit('src/lib.rs', 'lib'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no pub fns');
    expect(r.facts.crate).toBe('z');
  });
});

// =========================================================================
// angular — detect
// =========================================================================
describe('angularAdapter.detect', () => {
  it('scores 0.9 when @angular/core is a dependency', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { '@angular/core': '17' } }));
    expect(await angularAdapter.detect(d)).toBeCloseTo(0.9);
  });

  it('finds @angular/core in devDependencies too', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { '@angular/core': '17' } }));
    expect(await angularAdapter.detect(d)).toBeCloseTo(0.9);
  });

  it('returns 0 for a package.json without @angular/core', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { react: '18' } }));
    expect(await angularAdapter.detect(d)).toBe(0);
  });

  it('returns 0 when package.json is missing or unparseable (catch)', async () => {
    expect(await angularAdapter.detect(tmp())).toBe(0);
    const d = tmp();
    write(d, 'package.json', 'not json{');
    expect(await angularAdapter.detect(d)).toBe(0);
  });
});

// =========================================================================
// angular — discover (walkFiles under src/)
// =========================================================================
describe('angularAdapter.discover', () => {
  it('lists component/service .ts, skipping spec/module/d.ts/main/polyfills + node_modules', async () => {
    const d = tmp();
    write(d, 'src/app/foo.component.ts', 'export class FooComponent {}');
    write(d, 'src/app/bar.service.ts', 'export class BarService {}');
    write(d, 'src/app/foo.component.spec.ts', '');   // skipped (.spec)
    write(d, 'src/app/app.module.ts', '');            // skipped (.module)
    write(d, 'src/types.d.ts', '');                   // skipped (.d.ts)
    write(d, 'src/main.ts', '');                       // skipped (main)
    write(d, 'src/polyfills.ts', '');                  // skipped (polyfills)
    write(d, 'src/node_modules/lib/x.ts', '');         // skip dir
    write(d, 'src/styles.css', '');                    // not .ts
    const targets = await angularAdapter.discover(d, 'unit');
    const names = targets.map((t) => t.name);
    expect(names).toContain('foo.component');
    expect(names).toContain('bar.service');
    expect(names).not.toContain('app.module');
    expect(names).not.toContain('main');
    expect(names).not.toContain('polyfills');
    expect(names.some((n) => n.includes('spec'))).toBe(false);
    expect(targets.some((t) => t.sourcePath.includes('node_modules'))).toBe(false);
    expect(targets.every((t) => t.kind === 'unit')).toBe(true);
  });

  it('returns [] when src/ is missing (walkFiles catch)', async () => {
    expect(await angularAdapter.discover(tmp(), 'unit')).toEqual([]);
  });
});

// =========================================================================
// angular — probe
// =========================================================================
describe('angularAdapter.probe', () => {
  it('classifies a @Component and surfaces the class + exports', async () => {
    const d = tmp();
    write(
      d,
      'src/app/widget.component.ts',
      `import { Component } from '@angular/core';

export function helper(x: number): number { return x * 2; }

@Component({ selector: 'app-widget', template: '<div></div>' })
export class WidgetComponent {
  count = 0;
}
`,
    );
    const r = await angularAdapter.probe(d, unit('src/app/widget.component.ts', 'widget.component'));
    expect(r.ok).toBe(true);
    expect(r.facts.cls).toBe('WidgetComponent');
    expect(r.facts.isComponent).toBe(true);
    expect(r.facts.isService).toBe(false);
    expect(r.digest).toContain('GROUND TRUTH for src/app/widget.component.ts');
    expect(r.digest).toMatch(/class: WidgetComponent \(component\)/);
    expect(r.digest).toContain('TestBed.configureTestingModule');
    expect(r.digest).toMatch(/exports:.*helper/);
  });

  it('classifies an @Injectable service (non-component branch in digest)', async () => {
    const d = tmp();
    write(
      d,
      'src/app/data.service.ts',
      `import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DataService {
  get() { return 42; }
}
`,
    );
    const r = await angularAdapter.probe(d, unit('src/app/data.service.ts', 'data.service'));
    expect(r.ok).toBe(true);
    expect(r.facts.cls).toBe('DataService');
    expect(r.facts.isComponent).toBe(false);
    expect(r.facts.isService).toBe(true);
    expect(r.digest).toMatch(/class: DataService \(service\)/);
    expect(r.digest).toContain('TestBed.inject');
  });

  it('returns ok:false "no exported class" for a file with no exported class (incl. missing file)', async () => {
    const d = tmp();
    write(d, 'src/app/util.ts', 'const internal = 1;\n');
    const r1 = await angularAdapter.probe(d, unit('src/app/util.ts', 'util'));
    expect(r1.ok).toBe(false);
    expect(r1.error).toBe('no exported class');

    const r2 = await angularAdapter.probe(tmp(), unit('src/app/gone.ts', 'gone'));
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('no exported class');
  });
});

// =========================================================================
// node-vitest — detect (framework exclusion)
// =========================================================================
describe('nodeAdapter.detect', () => {
  it('scores vitest + typescript at 0.5 (capped)', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { vitest: '2', typescript: '5' } }));
    expect(await nodeAdapter.detect(d)).toBeCloseTo(0.5); // 0.4 + 0.1
  });

  it('scores vitest alone at 0.4', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { vitest: '2' } }));
    expect(await nodeAdapter.detect(d)).toBeCloseTo(0.4);
  });

  it('scores typescript alone at 0.1', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ devDependencies: { typescript: '5' } }));
    expect(await nodeAdapter.detect(d)).toBeCloseTo(0.1);
  });

  it('returns 0 when a UI framework owns the project (react/vue/svelte/angular)', async () => {
    for (const dep of ['react', 'vue', 'svelte', '@angular/core']) {
      const d = tmp();
      write(d, 'package.json', JSON.stringify({ dependencies: { [dep]: '1' }, devDependencies: { vitest: '2', typescript: '5' } }));
      expect(await nodeAdapter.detect(d)).toBe(0);
    }
  });

  it('returns 0 for a package.json with no vitest/typescript', async () => {
    const d = tmp();
    write(d, 'package.json', JSON.stringify({ dependencies: { lodash: '4' } }));
    expect(await nodeAdapter.detect(d)).toBe(0);
  });

  it('returns 0 when package.json is missing (readPackageDeps → {})', async () => {
    expect(await nodeAdapter.detect(tmp())).toBe(0);
  });
});

// =========================================================================
// node-vitest — discover
// =========================================================================
describe('nodeAdapter.discover', () => {
  it('lists .ts/.js sources, skipping test/spec/d.ts/index/main + node_modules/dist', async () => {
    const d = tmp();
    write(d, 'src/calc.ts', 'export const a = 1;');
    write(d, 'src/sub/util.js', 'module.exports = {};');
    write(d, 'src/calc.test.ts', '');     // skipped (.test)
    write(d, 'src/calc.spec.ts', '');      // skipped (.spec)
    write(d, 'src/types.d.ts', '');        // skipped (.d.ts)
    write(d, 'src/index.ts', '');          // skipped (index)
    write(d, 'src/main.ts', '');           // skipped (main)
    write(d, 'src/node_modules/dep/x.ts', ''); // skip dir
    write(d, 'src/dist/built.js', '');     // skip dir
    write(d, 'src/readme.md', '');         // not .ts/.js
    const targets = await nodeAdapter.discover(d, 'unit');
    const names = targets.map((t) => t.name);
    expect(names).toContain('calc');
    expect(names).toContain('util');
    expect(names).not.toContain('index');
    expect(names).not.toContain('main');
    expect(names.some((n) => n.includes('test') || n.includes('spec'))).toBe(false);
    expect(targets.some((t) => t.sourcePath.includes('node_modules'))).toBe(false);
    expect(targets.some((t) => t.sourcePath.includes('dist'))).toBe(false);
    expect(targets.every((t) => t.kind === 'unit')).toBe(true);
  });

  it('returns [] when src/ is missing (walkFiles catch)', async () => {
    expect(await nodeAdapter.discover(tmp(), 'unit')).toEqual([]);
  });
});

// =========================================================================
// node-vitest — probe (AST export extraction)
// =========================================================================
describe('nodeAdapter.probe', () => {
  it('extracts exported function signatures via the AST', async () => {
    const d = tmp();
    write(
      d,
      'src/calc.ts',
      `export function add(a: number, b: number): number { return a + b; }
export const inc = (n: number) => n + 1;
const internal = 7;
`,
    );
    const r = await nodeAdapter.probe(d, unit('src/calc.ts', 'calc'));
    expect(r.ok).toBe(true);
    const fns = r.facts.fns as string[];
    expect(fns.join(' ')).toMatch(/add\(a: number, b: number\): number/);
    expect(fns.some((f) => f.startsWith('inc'))).toBe(true);
    expect(r.digest).toContain('GROUND TRUTH for src/calc.ts (import from "./calc")');
    expect(r.digest).toMatch(/exported functions: .*add/);
    expect(r.digest).toContain('pure vitest unit test');
    expect(r.error).toBeUndefined();
  });

  it('returns ok:false "no exported functions" for a module with nothing exported (incl. missing file)', async () => {
    const d = tmp();
    write(d, 'src/nada.ts', 'const x = 1;\nfunction local() { return x; }\n');
    const r1 = await nodeAdapter.probe(d, unit('src/nada.ts', 'nada'));
    expect(r1.ok).toBe(false);
    expect(r1.error).toBe('no exported functions');

    const r2 = await nodeAdapter.probe(tmp(), unit('src/gone.ts', 'gone'));
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('no exported functions');
  });
});
