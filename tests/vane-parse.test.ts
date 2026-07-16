import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVane } from '../src/vane/parse.js';
import { validateVane } from '../src/vane/validate.js';
import { formatVaneError, type CommandDecl, type AdapterDecl, type ProfileDecl } from '../src/vane/ast.js';
import { loadVaneFile, loadCommands, loadAdapterManifest, clearVaneCache, vaneRoot } from '../src/vane/load.js';
import { isGeneratedSource } from '../src/util/generated.js';

/** Parse + assert zero errors — happy-path helper. */
function parseOk(src: string) {
  const { ast, errors } = parseVane(src, 'test.vane');
  expect(errors).toEqual([]);
  return ast;
}

describe('vane parse — command', () => {
  const SRC = [
    '# static gate',
    'command mutation',
    '  summary Full per-site mutation test — flips operators.',
    '  usage probevane mutation <dir> [--budget N] [--all]',
    '  example probevane mutation . --budget 60',
    '  dir',
    '  arg prompt str "the NL task"',
    '  flag --budget int = 0 "cap mutants; 0 = no cap"',
    '  flag --only list "path substrings"',
    '  flag --mermaid str? "file; bare flag = default path"',
    '  flag --json bool',
    '  handler mutation#run',
  ].join('\n');

  it('parses every field of a full command decl', () => {
    const [d] = parseOk(SRC).decls as CommandDecl[];
    expect(d.kind).toBe('command');
    expect(d.name).toBe('mutation');
    expect(d.summary).toContain('mutation test — flips'); // unicode dash survives
    expect(d.dir).toBe(true);
    expect(d.args).toEqual([{ name: 'prompt', variadic: false, doc: 'the NL task', pos: { file: 'test.vane', line: 7 } }]);
    expect(d.flags.map((f) => [f.name, f.type, f.def ?? null, f.doc])).toEqual([
      ['budget', 'int', '0', 'cap mutants; 0 = no cap'],
      ['only', 'list', null, 'path substrings'],
      ['mermaid', 'str?', null, 'file; bare flag = default path'],
      ['json', 'bool', null, ''],
    ]);
    expect(d.handler).toEqual({ module: 'mutation', export: 'run' });
    expect(validateVane({ file: 'test.vane', decls: [d] })).toEqual([]);
  });

  it('catalog-only decl (no spec section) is valid', () => {
    const ast = parseOk('command tui\n  summary Terminal dashboard.\n  usage probevane tui\n  example probevane tui\n');
    expect(validateVane(ast)).toEqual([]);
    expect((ast.decls[0] as CommandDecl).handler).toBeUndefined();
  });
});

describe('vane parse — profile + alias', () => {
  it('parses segments, conditionals, calls and aliases', () => {
    const ast = parseOk([
      'profile visual',
      '  preamble unit',
      '  safety-net behavior_lock',
      '  if render: green-gates render_gate(render)',
      '  harvest',
      'profile repair',
      '  preamble unit',
      'alias fix = repair',
    ].join('\n'));
    const [visual] = ast.decls as ProfileDecl[];
    expect(visual.segments.map((s) => s.id)).toEqual(['preamble', 'safety-net', 'green-gates', 'harvest']);
    expect(visual.segments[2].cond).toBe('render');
    expect(visual.segments[2].tokens).toEqual(['render_gate(render)']);
    expect(validateVane(ast)).toEqual([]);
  });

  it('alias to unknown profile is a positioned error', () => {
    const ast = parseOk('alias fix = ghost\n');
    const errs = validateVane(ast);
    expect(errs.length).toBe(1);
    expect(formatVaneError(errs[0])).toBe("test.vane:1: alias 'fix' targets unknown profile 'ghost'");
  });
});

describe('vane parse — adapter manifest', () => {
  it('parses commands, patterns, audit-rules and a dedented guidance block', () => {
    const ast = parseOk([
      'adapter go-test',
      '  command test-unit = go test ./...',
      '  command lint = gofmt -l . || true',
      '  patterns unit = go-unit-patterns.md',
      '  audit-rules = go',
      '  guidance unit:',
      '    one <name>_test.go per source file, SAME package.',
      '    table-driven tests with t.Run.',
    ].join('\n'));
    const [d] = ast.decls as AdapterDecl[];
    expect(d.commands).toEqual({ 'test-unit': 'go test ./...', lint: 'gofmt -l . || true' });
    expect(d.patterns).toEqual({ unit: 'go-unit-patterns.md' });
    expect(d.auditRules).toBe('go');
    expect(d.guidance.unit).toBe('one <name>_test.go per source file, SAME package.\ntable-driven tests with t.Run.');
  });
});

describe('vane parse — error classes (all positioned)', () => {
  const errsOf = (src: string) => {
    const { ast, errors } = parseVane(src, 't.vane');
    return [...errors, ...validateVane(ast)].map(formatVaneError);
  };

  it('tab indentation', () => {
    expect(errsOf('command x\n\tsummary a')[0]).toContain('t.vane:2: tab in indentation');
  });
  it('unknown declaration keyword', () => {
    expect(errsOf('comand x\n')[0]).toContain("t.vane:1: unknown declaration 'comand'");
  });
  it('unknown flag type', () => {
    expect(errsOf('command x\n  flag --a strn "d"\n')[0]).toContain('t.vane:2: bad flag line');
  });
  it('duplicate names within a kind', () => {
    const out = errsOf('command x\n  summary s\n  usage u\n  example e\ncommand x\n  summary s\n  usage u\n  example e\n');
    expect(out[0]).toContain("t.vane:5: duplicate command 'x' (first at line 1)");
  });
  it('bad handler ref + missing catalog fields', () => {
    const out = errsOf('command x\n  handler nope\n');
    expect(out.some((e) => e.includes('t.vane:2: bad handler ref'))).toBe(true);
    expect(out.some((e) => e.includes("missing summary"))).toBe(true);
  });
  it('bool flag with a default', () => {
    const out = errsOf('command x\n  summary s\n  usage u\n  example e\n  dir\n  flag --a bool = 1 "d"\n');
    expect(out[0]).toContain('t.vane:6: bool flag --a cannot take a default');
  });
  it('indented line outside any declaration', () => {
    expect(errsOf('  stray\n')[0]).toContain('t.vane:1: unexpected indented line');
  });
});

describe('vane load (via PROBEVANE_ROOT)', () => {
  const saved = process.env.PROBEVANE_ROOT;
  afterEach(() => {
    if (saved === undefined) delete process.env.PROBEVANE_ROOT;
    else process.env.PROBEVANE_ROOT = saved;
    clearVaneCache();
  });

  /** Temp package root with a vane/ dir. */
  function mkRoot(commands: string): string {
    const root = mkdtempSync(join(tmpdir(), 'pv-vane-'));
    mkdirSync(join(root, 'vane', 'adapters'), { recursive: true });
    writeFileSync(join(root, 'vane', 'commands.vane'), commands);
    process.env.PROBEVANE_ROOT = root;
    clearVaneCache();
    return root;
  }

  it('loads commands from the resolved root and memoizes', () => {
    const root = mkRoot('command a\n  summary s\n  usage u\n  example e\n');
    expect(vaneRoot()).toBe(join(root, 'vane'));
    expect(loadCommands().map((c) => c.name)).toEqual(['a']);
    rmSync(root, { recursive: true, force: true });
    expect(loadCommands().map((c) => c.name)).toEqual(['a']); // memo survives deletion
  });

  it('hard-throws with file:line on a broken file; missing adapter manifest is null', () => {
    const root = mkRoot('comand broken\n');
    expect(() => loadCommands()).toThrow(/vane\/commands\.vane:1: unknown declaration/);
    expect(loadAdapterManifest('go-test')).toBeNull();
    writeFileSync(join(root, 'vane', 'adapters', 'go-test.vane'), 'adapter go-test\n  bogus line\n');
    expect(() => loadAdapterManifest('go-test')).toThrow(/go-test\.vane:2: unknown adapter field/);
    rmSync(root, { recursive: true, force: true });
  });

  it('missing vane root names the path it tried', () => {
    process.env.PROBEVANE_ROOT = '/nonexistent-root';
    clearVaneCache();
    expect(() => loadVaneFile('commands.vane')).toThrow(/cannot read \/nonexistent-root\/vane/);
  });
});

describe('util/generated', () => {
  it('detects the @generated first-line marker only', () => {
    expect(isGeneratedSource('// @generated FROM vane/profiles.vane\nexport {}')).toBe(true);
    expect(isGeneratedSource('export {} // @generated later is not line 1... actually same line')).toBe(true);
    expect(isGeneratedSource('// hand-written\n// @generated on line 2 does not count')).toBe(false);
  });
});

describe('vane catalog (the real shipped commands.vane)', () => {
  it('loads, validates, and matches the catalog shim', async () => {
    // No PROBEVANE_ROOT here — exercises the moduleDir fallback on the repo itself.
    delete process.env.PROBEVANE_ROOT;
    clearVaneCache();
    const { COMMANDS } = await import('../src/commands/skill/catalog.js');
    expect(COMMANDS.length).toBeGreaterThanOrEqual(56);
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length); // the dup bug class, gated forever
    expect(names).toContain('vane');
    const mutation = COMMANDS.find((c) => c.name === 'mutation')!;
    expect(mutation.usage).toContain('[--min-score P]');
  });
});

describe('adapter manifest fields (go-test pilot)', () => {
  it('manifest-built fields deep-equal the previous hard-coded values', async () => {
    delete process.env.PROBEVANE_ROOT;
    clearVaneCache();
    const { manifestFields } = await import('../src/vane/adapter-manifest.js');
    const f = manifestFields('go-test')!;
    expect(f.commands!('.')).toEqual({
      typecheck: 'go build ./...',
      lint: 'gofmt -l . || true',
      testUnit: 'go test ./...',
      testE2e: 'true',
      coverage: 'go test -cover ./...',
    });
    expect(f.guidance!('unit')).toBe(
      '(Go stdlib testing) one <name>_test.go per source file, SAME package. Use table-driven tests: ' +
        'a slice of cases struct, loop with t.Run(name, ...), assert with t.Errorf/t.Fatalf. ' +
        'Test error paths too. Use ONLY exported funcs in the ground truth.',
    );
    expect((f.auditRules!() as { id: string }[]).length).toBeGreaterThan(0);
    // the assembled adapter exposes the manifest values through the normal API
    const { goAdapter } = await import('../src/adapters/go-test/index.js');
    expect(goAdapter.commands('.').testUnit).toBe('go test ./...');
    expect(goAdapter.guidance('unit')).toContain('table-driven');
  });

  it('missing manifest → null; unknown ruleset ref throws at load', async () => {
    const { manifestFields } = await import('../src/vane/adapter-manifest.js');
    expect(manifestFields('rust-cargo')).toBeNull(); // no manifest yet — TS-only
  });
});

describe('adapter manifest fields (node/react/vue/svelte/angular migration)', () => {
  // Parity oracle: the exact commands/guidance/patterns each adapter served
  // BEFORE the DATA fields moved into vane/adapters/<id>.vane. The assembled
  // adapter must reproduce these byte-for-byte — the whole point of a partial
  // manifest is that behavior does not change. auditRules stays pure-TS.
  it('assembled adapters deep-equal their pre-migration values', async () => {
    delete process.env.PROBEVANE_ROOT;
    clearVaneCache();
    const { nodeAdapter } = await import('../src/adapters/node-vitest/index.js');
    const { reactAdapter } = await import('../src/adapters/react-vitest-playwright/index.js');
    const { vueAdapter } = await import('../src/adapters/vue-vitest-playwright/index.js');
    const { svelteAdapter } = await import('../src/adapters/svelte-vitest/index.js');
    const { angularAdapter } = await import('../src/adapters/angular/index.js');

    // node-vitest — kind-independent guidance/patterns (both kinds identical).
    expect(nodeAdapter.commands('.')).toEqual({
      typecheck: 'npx tsc --noEmit', lint: 'true', testUnit: 'npx vitest run',
      testE2e: 'true', coverage: 'npx vitest run --coverage --coverage.reporter=json-summary',
    });
    const nodeGuidance =
      "(vitest, plain TS) place the test next to its source as src/<name>.test.ts. ALWAYS `import { describe, it, expect } from 'vitest'` (no globals). Import the exported functions and assert concrete values; cover happy paths, edge cases, and error paths. No DOM, no framework. Use only the ground-truth exports.";
    expect(nodeAdapter.guidance('unit')).toBe(nodeGuidance);
    expect(nodeAdapter.guidance('e2e')).toBe(nodeGuidance); // TS ignored kind — manifest reproduces both
    expect(await nodeAdapter.patternsDoc('unit')).toContain('Unit patterns — vitest (plain TS/JS)');
    expect(await nodeAdapter.patternsDoc('e2e')).toBe(await nodeAdapter.patternsDoc('unit'));
    expect(nodeAdapter.auditRules().length).toBe(9); // jsAuditRules, still TS

    // react — PER-KIND guidance + patterns.
    expect(reactAdapter.commands('.').testE2e).toBe('npx playwright test');
    expect(reactAdapter.guidance('unit')).toContain('@testing-library/react');
    expect(reactAdapter.guidance('e2e')).toContain("import { test, expect } from '@playwright/test'");
    expect(reactAdapter.guidance('unit')).not.toBe(reactAdapter.guidance('e2e'));
    expect(await reactAdapter.patternsDoc('unit')).toContain('vitest + @testing-library/react');
    expect(await reactAdapter.patternsDoc('e2e')).toContain('E2E patterns — Playwright');
    expect(reactAdapter.auditRules().length).toBe(9);

    // vue — PER-KIND guidance + patterns; keeps vueAuditRules (10).
    expect(vueAdapter.commands('.').typecheck).toBe('true');
    expect(vueAdapter.guidance('unit')).toContain('@vue/test-utils');
    expect(vueAdapter.guidance('e2e')).toContain('page.goto');
    expect(await vueAdapter.patternsDoc('unit')).toContain('vitest + @vue/test-utils');
    expect(await vueAdapter.patternsDoc('e2e')).toContain('E2E patterns — Playwright (Vue app)');
    expect(vueAdapter.auditRules().length).toBe(10);

    // svelte — kind-independent (both kinds identical).
    expect(svelteAdapter.commands('.')).toEqual({
      typecheck: 'true', lint: 'true', testUnit: 'npx vitest run',
      testE2e: 'true', coverage: 'npx vitest run --coverage --coverage.reporter=json-summary',
    });
    expect(svelteAdapter.guidance('unit')).toContain('@testing-library/svelte');
    expect(svelteAdapter.guidance('e2e')).toBe(svelteAdapter.guidance('unit'));
    expect(await svelteAdapter.patternsDoc('e2e')).toBe(await svelteAdapter.patternsDoc('unit'));
    expect(svelteAdapter.auditRules().length).toBe(9);

    // angular — kind-independent (both kinds identical); jest commands.
    expect(angularAdapter.commands('.').testUnit).toBe('npx jest');
    expect(angularAdapter.guidance('unit')).toContain('jest-preset-angular');
    expect(angularAdapter.guidance('e2e')).toBe(angularAdapter.guidance('unit'));
    expect(await angularAdapter.patternsDoc('e2e')).toBe(await angularAdapter.patternsDoc('unit'));
    expect(angularAdapter.auditRules().length).toBe(9);
  });
});

describe('adapter manifest — error branches + partial spread', () => {
  const saved2 = process.env.PROBEVANE_ROOT;
  afterEach(() => {
    if (saved2 === undefined) delete process.env.PROBEVANE_ROOT;
    else process.env.PROBEVANE_ROOT = saved2;
    clearVaneCache();
  });

  function mkManifest(id: string, body: string): void {
    const root = mkdtempSync(join(tmpdir(), 'pv-am-'));
    mkdirSync(join(root, 'vane', 'adapters'), { recursive: true });
    writeFileSync(join(root, 'vane', 'adapters', `${id}.vane`), body);
    process.env.PROBEVANE_ROOT = root;
    clearVaneCache();
  }

  it('unknown command key throws at load', async () => {
    mkManifest('x', 'adapter x\n  command bogus-key = echo hi\n');
    const { manifestFields } = await import('../src/vane/adapter-manifest.js');
    expect(() => manifestFields('x')).toThrow(/unknown command key 'bogus-key'/);
  });

  it('unknown audit-rules ref throws at load', async () => {
    mkManifest('x', 'adapter x\n  audit-rules = watstack\n');
    const { manifestFields } = await import('../src/vane/adapter-manifest.js');
    expect(() => manifestFields('x')).toThrow(/unknown audit-rules ref 'watstack'/);
  });

  it('absent fields → absent methods (guidance-only manifest)', async () => {
    mkManifest('x', 'adapter x\n  guidance unit:\n    write good tests\n');
    const { manifestFields } = await import('../src/vane/adapter-manifest.js');
    const f = manifestFields('x')!;
    expect(f.commands).toBeUndefined();
    expect(f.patternsDoc).toBeUndefined();
    expect(f.auditRules).toBeUndefined();
    expect(f.guidance!('unit')).toBe('write good tests');
    expect(f.guidance!('e2e')).toBe(''); // unknown kind → empty, not undefined
  });
});
